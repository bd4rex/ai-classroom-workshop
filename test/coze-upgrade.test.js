import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { openDatabase } from "../server/database.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

test(
  "扣子先同步 NOT NULL 列会失败；停写预迁移保留旧字段和回执并允许应用完成升级",
  { skip: !databaseUrl },
  async (t) => {
    const schema = `test_${randomUUID().replaceAll("-", "")}`;
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const options = { connectionString: databaseUrl, schema };
    const handles = new Set();
    t.after(async () => {
      await Promise.all([...handles].map((db) => db.close()));
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    });
    const initial = await openDatabase(undefined, options);
    handles.add(initial);
    await initial.run("INSERT INTO meta VALUES (?,?)", "fixture", "preserve-me");
    await initial.run("INSERT INTO teachers VALUES (?,?)", "synthetic-session", 999);
    await initial.run("INSERT INTO rooms(id,code,created_at) VALUES (?,?,?)", "room", "111111", 1);
    for (const id of ["p1", "p2"])
      await initial.run("INSERT INTO participants(id,room_id,token,expires) VALUES (?,?,?,?)", id, "room", `synthetic-${id}`, 999);
    for (const [participant, kind, content, deleted] of [
      ["p1", "discover", '{"value":"synthetic observation"}', null],
      ["p1", "design", '{"value":"synthetic design"}', null],
      ["p2", "discover", "{}", 100],
    ])
      await initial.run("INSERT INTO submissions(room_id,participant_id,kind,content,created_at,deleted_at,activity_id) VALUES (?,?,?,?,?,?,?)", "room", participant, kind, content, 1, deleted, kind);
    await initial.close();
    handles.delete(initial);
    await pool.query(`ALTER TABLE "${schema}".submissions DROP COLUMN activity_id;
      ALTER TABLE "${schema}".submissions ADD CONSTRAINT submissions_participant_id_kind_key UNIQUE(participant_id,kind);
      ALTER TABLE "${schema}".submissions DROP CONSTRAINT submissions_kind_check;
      ALTER TABLE "${schema}".submissions ADD CONSTRAINT submissions_kind_check CHECK(kind IN ('discover','design'));`);
    const oldColumns = "id,room_id,participant_id,kind,content,created_at,deleted_at";
    const before = (await pool.query(`SELECT ${oldColumns} FROM "${schema}".submissions ORDER BY id`)).rows;
    const preserved = {};
    for (const table of ["meta", "teachers", "rooms", "participants"])
      preserved[table] = (await pool.query(`SELECT * FROM "${schema}".${table} ORDER BY 1`)).rows;

    // Reproduce schema-first deployment before the app's backfill can run.
    await assert.rejects(
      pool.query(`ALTER TABLE "${schema}".submissions ADD COLUMN activity_id TEXT NOT NULL`),
      { code: "23502" },
    );
    assert.equal((await pool.query("SELECT COUNT(*)::int n FROM information_schema.columns WHERE table_schema=$1 AND table_name='submissions' AND column_name='activity_id'", [schema])).rows[0].n, 0);

    // Only the schema qualifier is changed; execute the delivered SQL verbatim otherwise.
    const sql = readFileSync(new URL("../deploy/sql/coze-activity-id-premigration.sql", import.meta.url), "utf8").replaceAll("public.", `"${schema}".`);
    const client = await pool.connect();
    try {
      await client.query(sql);
      await client.query(sql); // Idempotent for an already prepared production schema.
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    assert.deepEqual((await pool.query(`SELECT ${oldColumns} FROM "${schema}".submissions ORDER BY id`)).rows, before);
    assert.deepEqual((await pool.query(`SELECT activity_id FROM "${schema}".submissions ORDER BY id`)).rows.map((row) => row.activity_id), ["discover", "design", "discover"]);
    assert.equal((await pool.query("SELECT is_nullable FROM information_schema.columns WHERE table_schema=$1 AND table_name='submissions' AND column_name='activity_id'", [schema])).rows[0].is_nullable, "NO");
    for (const table of Object.keys(preserved))
      assert.deepEqual((await pool.query(`SELECT * FROM "${schema}".${table} ORDER BY 1`)).rows, preserved[table]);

    const upgraded = await openDatabase(undefined, options);
    handles.add(upgraded);
    for (const id of ["activity-one", "activity-two"])
      await upgraded.run("INSERT INTO submissions(room_id,participant_id,kind,content,created_at,activity_id) VALUES (?,?,?,?,?,?)", "room", "p1", "judge", "{}", 2, id);
    await upgraded.run("UPDATE submissions SET activity_id=? WHERE id=?", "preserve-custom-id", 1);
    const repeat = await pool.connect();
    try {
      await repeat.query(sql);
    } catch (error) {
      await repeat.query("ROLLBACK");
      throw error;
    } finally {
      repeat.release();
    }
    assert.equal((await upgraded.get("SELECT activity_id FROM submissions WHERE id=?", 1)).activity_id, "preserve-custom-id");
    assert.equal((await upgraded.get("SELECT COUNT(*) n FROM submissions WHERE kind=?", "judge")).n, 2);
    assert.equal((await upgraded.get("SELECT content FROM submissions WHERE deleted_at IS NOT NULL")).content, "{}");
  },
);

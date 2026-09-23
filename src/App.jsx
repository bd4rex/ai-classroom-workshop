import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Lightbulb,
  LockKeyhole,
  Pause,
  Play,
  Monitor,
  CircleCheck,
  LogOut,
  Search,
  Sparkles,
  Trash2,
  Clock3,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { api } from "./api.js";
import { createRefreshQueue } from "./refresh-queue.js";
import { watchClassroomEvents } from "./live-connection.js";

const activities = {
  discover: {
    number: "01",
    title: "一起发现",
    subtitle: "身边的人工智能应用",
    icon: Search,
    caption: "留心身边的小事，发现 AI 正在怎样帮助我们。",
  },
  design: {
    number: "02",
    title: "一起设计",
    subtitle: "未来的人工智能应用",
    icon: Lightbulb,
    caption: "从一个真实的需要出发，为未来设计一种可能。",
  },
};
const emptyDiscovery = {
  name: "",
  school: "",
  field: "",
  scenario: "",
  value: "",
};
const emptyDesign = { scenario: "", function: "" };
function useClassroom(role, classroomId) {
  const [state, setState] = useState(null),
    [loading, setLoading] = useState(true);
  const [error, setError] = useState(""),
    [connected, setConnected] = useState(false),
    [ended, setEnded] = useState(false);
  const queue = useRef();
  useEffect(() => {
    let active = true;
    queue.current = createRefreshQueue(async () => {
      try {
        const query = new URLSearchParams({
          role,
          ...(role === "student" ? { classroomId } : {}),
        });
        let result = await api(`/api/session?${query}`);
        if (!active) return;
        if (role === "student" && !result.state) {
          result = await api("/api/join", { classroomId });
        }
        if (active) {
          setState(result.state);
          setEnded(!!result.ended);
          setError("");
        }
      } catch (e) {
        if (active) {
          if (e.status === 401) setState(null);
          else setError(e.message);
        }
      } finally {
        if (active) setLoading(false);
      }
    });
    queue.current.update();
    return () => {
      active = false;
      queue.current.stop();
    };
  }, [role, classroomId]);
  const authenticated = !!state;
  useEffect(() => {
    if (!authenticated) return;
    const query = new URLSearchParams({
      role,
      ...(role === "student" ? { classroomId } : {}),
    });
    const update = () => queue.current.update();
    const stopEvents = watchClassroomEvents(`/api/events?${query}`, {
      onLive: setConnected,
      onUpdate: update,
    });
    const timer = setInterval(update, 6000 + Math.random() * 1500);
    const visible = () => {
      if (document.visibilityState === "visible") update();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopEvents();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      setConnected(false);
    };
  }, [authenticated, role, classroomId]);
  return {
    state,
    loading,
    error,
    ended,
    connection: error ? "offline" : connected ? "live" : "polling",
    refresh: useCallback(() => queue.current.update(), []),
  };
}
function useDraft(key, defaults) {
  const [value, setValue] = useState(() => {
    try {
      return {
        ...defaults,
        ...JSON.parse(sessionStorage.getItem(key) || "{}"),
      };
    } catch {
      return defaults;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value]);
  return [
    value,
    (field, next) => setValue((old) => ({ ...old, [field]: next })),
  ];
}
function ErrorText({ children }) {
  return children ? (
    <p className="error" role="alert">
      {children}
    </p>
  ) : null;
}
function Header({ teacher, state, connection, onLogout }) {
  const syncLabels = {
    live: "课堂实时同步",
    polling: "课堂定时同步",
    offline: "连接中断，正在重试",
  };
  return (
    <header className="site-header">
      <a className="brand" href={teacher ? "/teacher" : location.pathname}>
        <span className="brand-mark">
          <Sparkles size={23} />
        </span>
        <span>
          AI 共创课堂<small>发现 · 思考 · 创造</small>
        </span>
      </a>
      <div className="header-right">
        {state ? (
          <span
            className={`connection ${connection === "offline" ? "reconnecting" : ""}`}
            role="status"
            title={
              connection === "polling"
                ? "当前每 6–8 秒自动同步；实时连接恢复后会自动切回。"
                : undefined
            }
          >
            {connection === "live" ? (
              <Wifi size={15} />
            ) : connection === "polling" ? (
              <Clock3 size={15} />
            ) : (
              <WifiOff size={15} />
            )}
            {syncLabels[connection]}
          </span>
        ) : (
          <span className="header-note">人工智能通识课</span>
        )}
        {teacher && state ? (
          <button className="text-button" onClick={onLogout}>
            <LogOut size={15} />
            退出
          </button>
        ) : !teacher ? (
          <a className="role-link" href="/teacher">
            教师入口
            <ArrowRight size={14} />
          </a>
        ) : null}
      </div>
    </header>
  );
}
function TeacherEntry({ refresh }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/login", { password: value });
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="entry-layout">
      <section className="entry-intro">
        <span className="eyebrow">AI EXPLORATION LAB</span>
        <h1>
          每一个发现，
          <br />
          都是未来的起点<span>。</span>
        </h1>
        <p>
          看看人工智能如何走进生活，
          <br />
          再用你的想象，设计下一个好点子。
        </p>
        <div className="entry-steps">
          <span>
            <Search size={19} />
            一起发现
          </span>
          <ArrowRight size={18} />
          <span>
            <Lightbulb size={19} />
            一起设计
          </span>
        </div>
        <div className="orbit-art" aria-hidden="true">
          <div className="orbit-ring" />
          <div className="art-core">
            <Sparkles size={54} />
          </div>
          <span className="art-dot dot-one" />
          <span className="art-dot dot-two" />
          <span className="art-label">让想法在这里相遇</span>
        </div>
      </section>
      <section className="entry-form">
        <span className="pill">教师工作台</span>
        <h2>准备好，一起出发</h2>
        <p>
          由你控制页面开关、主题切换和课堂节奏。登录后复制学生端链接，分享给学生。
        </p>
        <form onSubmit={submit}>
          <label htmlFor="entry-value">教师密码</label>
          <input
            id="entry-value"
            type="password"
            autoComplete="current-password"
            maxLength={128}
            placeholder="请输入教师密码"
            value={value}
            required
            onChange={(e) => setValue(e.target.value)}
          />
          <ErrorText>{error}</ErrorText>
          <button className="primary wide" disabled={busy}>
            {busy ? "正在进入…" : "进入教师工作台"}
            <ArrowRight size={18} />
          </button>
        </form>
        <p className="fine-print">首次启动时，教师密码显示在服务终端中。</p>
      </section>
    </main>
  );
}
function StudentEntrance({ ended, error, refresh }) {
  return (
    <main className="workspace student-workspace">
      <section className="classroom-curtain" aria-live="polite">
        <div className="curtain-icon">
          {ended ? <CircleCheck size={38} /> : <LockKeyhole size={38} />}
        </div>
        <span className="eyebrow">AI 共创课堂</span>
        <h1>{ended ? "本节课堂已结束" : "暂时无法进入课堂"}</h1>
        <p>
          {ended
            ? "这节课堂已经结束，谢谢你的参与。"
            : error || "请打开老师分享的完整学生链接。"}
        </p>
        {!ended && (
          <button className="secondary" onClick={refresh}>
            重新连接课堂
          </button>
        )}
      </section>
    </main>
  );
}
function ActivityTitle({ kind, open, submitted, paused }) {
  const a = activities[kind],
    Icon = a.icon;
  return (
    <>
      <div className="activity-top">
        <span className={`step-icon ${kind}`}>
          <Icon size={22} />
        </span>
        <span
          className={`status ${submitted ? "submitted" : open ? "open" : "closed"}`}
        >
          {submitted ? (
            <>
              <Check size={13} />
              已提交
            </>
          ) : open ? (
            "开放提交中"
          ) : paused ? (
            "老师已暂停"
          ) : (
            "等待老师开放"
          )}
        </span>
      </div>
      <h2>
        <span className="step-number">{a.number}</span>
        {a.title}
      </h2>
      <h3>{a.subtitle}</h3>
      <p className="activity-caption">{a.caption}</p>
    </>
  );
}
function Field({
  id,
  label,
  value,
  change,
  maxLength,
  placeholder,
  multiline = false,
  children,
}) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        <span>必填</span>
      </label>
      {children ||
        (multiline ? (
          <textarea
            id={id}
            value={value}
            onChange={(e) => change(e.target.value)}
            maxLength={maxLength}
            placeholder={placeholder}
            required
            rows={3}
          />
        ) : (
          <input
            id={id}
            value={value}
            onChange={(e) => change(e.target.value)}
            maxLength={maxLength}
            placeholder={placeholder}
            required
          />
        ))}
    </div>
  );
}
function StudentActivity({ kind, state, refresh }) {
  const { room, me, submissions, schools } = state;
  const submitted = submissions[kind],
    open = room[`${kind}Open`];
  const needsIdentity = !me.name || !me.school;
  const [identity, changeIdentity] = useDraft(
    `ai-workshop:${room.id}:${me.id}:identity`,
    { name: "", school: "" },
  );
  const [draft, change] = useDraft(
    `ai-workshop:${room.id}:${me.id}:${kind}`,
    kind === "discover" ? emptyDiscovery : emptyDesign,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const content =
      kind === "discover"
        ? { field: draft.field, scenario: draft.scenario, value: draft.value }
        : { scenario: draft.scenario, function: draft.function };
    try {
      await api(
        `/api/student/submit/${kind}?classroomId=${encodeURIComponent(room.id)}`,
        {
          ...content,
          ...(needsIdentity ? identity : {}),
        },
      );
      await refresh();
    } catch (e) {
      setError(e.message);
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const editable = (field) => ({
    id: `${kind}-${field}`,
    value: draft[field],
    change: (v) => change(field, v),
  });
  return (
    <article className={`activity student-activity ${kind}`}>
      <ActivityTitle
        kind={kind}
        open={open}
        submitted={submitted}
        paused={room.paused}
      />
      {submitted ? (
        <div className="submitted-content">
          <div
            className={`saved-title ${submitted.removed ? "removed-title" : ""}`}
          >
            {submitted.removed ? <Trash2 size={18} /> : <Check size={18} />}
            {submitted.removed ? "本主题作品已被老师移除" : "本主题提交成功"}
          </div>
          <p className="identity">
            {me.school}
            <span>·</span>
            {me.name}
          </p>
          {!submitted.removed && (
            <dl>
              {kind === "discover" && (
                <>
                  <dt>领域</dt>
                  <dd>{submitted.field}</dd>
                </>
              )}
              <dt>{kind === "discover" ? "应用场景" : "场景"}</dt>
              <dd>{submitted.scenario}</dd>
              <dt>{kind === "discover" ? "价值" : "基本功能"}</dt>
              <dd>
                {kind === "discover" ? submitted.value : submitted.function}
              </dd>
            </dl>
          )}
          <p className="saved-hint">
            {submitted.removed
              ? "如有疑问请联系老师。你仍可以阅读本主题的同学分享。"
              : "同学的分享已解锁，一起看看其他人的想法。"}
          </p>
        </div>
      ) : (
        <form onSubmit={submit}>
          <fieldset disabled={!open || busy}>
            {needsIdentity ? (
              <div className="field-pair">
                <Field id={`${kind}-school`} label="学校">
                  <select
                    id={`${kind}-school`}
                    value={identity.school}
                    onChange={(e) => changeIdentity("school", e.target.value)}
                    required
                  >
                    <option value="">请选择学校</option>
                    {schools.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  id={`${kind}-name`}
                  label="姓名"
                  value={identity.name}
                  change={(v) => changeIdentity("name", v)}
                  maxLength={40}
                  placeholder="你的姓名"
                />
              </div>
            ) : (
              <p className="identity">
                {me.school} · {me.name}
              </p>
            )}
            {kind === "discover" ? (
              <>
                <Field
                  {...editable("field")}
                  label="领域"
                  maxLength={80}
                  placeholder="例如：交通、学习、医疗……"
                />
                <Field
                  {...editable("scenario")}
                  label="应用场景"
                  maxLength={500}
                  placeholder="你在什么地方，看到了什么 AI 应用？"
                  multiline
                />
                <Field
                  {...editable("value")}
                  label="价值"
                  maxLength={500}
                  placeholder="它解决了什么问题？带来了什么帮助？"
                  multiline
                />
              </>
            ) : (
              <>
                <Field
                  {...editable("scenario")}
                  label="场景"
                  maxLength={500}
                  placeholder="未来，你希望人工智能用在什么地方？"
                  multiline
                />
                <Field
                  {...editable("function")}
                  label="基本功能"
                  maxLength={500}
                  placeholder="它能做哪些事？你希望它怎样帮助人们？"
                  multiline
                />
                <div className="thought-note">
                  <Sparkles size={18} />
                  <p>大胆想象，也想一想：这个设计能为谁解决什么问题？</p>
                </div>
              </>
            )}
            <button
              className={`primary wide ${kind === "design" ? "warm" : ""}`}
              disabled={!open || busy}
            >
              {busy ? "正在提交…" : "提交并查看同学分享"}
              <ArrowRight size={17} />
            </button>
          </fieldset>
          <ErrorText>{error}</ErrorText>
          <p className="form-hint">
            先独立思考；提交后，你的学校、姓名和作品将与本主题已提交的同学互相可见。
          </p>
        </form>
      )}
    </article>
  );
}
function TeacherControls({ state, refresh }) {
  const { room, counts } = state;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [ending, setEnding] = useState(false);
  const ended = room.stage === "ended",
    active = !!activities[room.stage];
  const control = async (change) => {
    setBusy(true);
    setError("");
    try {
      await api("/api/teacher/control", {
        roomId: room.id,
        revision: room.revision,
        ...change,
      });
      await refresh();
      setEnding(false);
    } catch (e) {
      setError(e.message);
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="lesson-control" aria-labelledby="lesson-control-title">
      <div className="control-heading">
        <div>
          <h2 id="lesson-control-title">课堂节奏</h2>
          <p>这里的每次切换，都会同步到学生页面。</p>
        </div>
        <button
          role="switch"
          aria-label="课堂页面开关"
          aria-checked={room.pageOpen}
          className={`switch-button ${room.pageOpen ? "is-on" : ""}`}
          disabled={busy}
          onClick={() => control({ action: "page", open: !room.pageOpen })}
        >
          <span className="switch-track">
            <span />
          </span>
          {room.pageOpen ? "学生页面已开放" : "学生页面已关闭"}
        </button>
      </div>
      <div className="stage-controls">
        <button
          className={`stage-choice ${room.stage === "waiting" ? "selected" : ""}`}
          aria-pressed={room.stage === "waiting"}
          disabled={busy || ended || room.stage === "waiting"}
          onClick={() => control({ action: "stage", stage: "waiting" })}
        >
          <span className="stage-choice-icon">
            <Monitor size={22} />
          </span>
          <strong>课前等候</strong>
          <span>学生加入后等待老师开始</span>
        </button>
        {Object.entries(activities).map(([kind, a]) => (
          <button
            key={kind}
            className={`stage-choice ${kind} ${room.stage === kind ? "selected" : ""}`}
            aria-pressed={room.stage === kind}
            aria-label={`切换到${a.title}`}
            disabled={busy || ended || room.stage === kind}
            onClick={() => control({ action: "stage", stage: kind })}
          >
            <span className="stage-choice-icon">
              <a.icon size={22} />
            </span>
            <strong>
              {a.number} · {a.title}
            </strong>
            <span>{a.subtitle}</span>
            <small>
              {counts[kind]} 份提交{room.stage === kind ? " · 当前主题" : ""}
            </small>
          </button>
        ))}
      </div>
      <div className="pace-actions">
        <span className="pace-state" role="status">
          {ended
            ? "本节课已结束"
            : !room.pageOpen
              ? "学生看到等候页，打开页面后跟随当前主题。"
              : room.stage === "waiting"
                ? "学生正在等候，请选择一个主题开始。"
                : `全班正在：${activities[room.stage].title}${room.paused ? "（暂停填写）" : ""}`}
        </span>
        <div>
          {active && !ended && (
            <button
              className="secondary"
              disabled={busy || !room.pageOpen}
              onClick={() => control({ action: "pause", paused: !room.paused })}
            >
              {room.paused ? <Play size={15} /> : <Pause size={15} />}
              {room.paused ? "继续填写" : "暂停填写"}
            </button>
          )}
          {!ended && (
            <button
              className="text-button end-button"
              disabled={busy}
              onClick={() => setEnding(true)}
            >
              结束本节课
            </button>
          )}
        </div>
      </div>
      {ending && (
        <div className="end-confirm" role="group" aria-label="结束课堂确认">
          <p>结束后所有学生将进入结束页，不能再填写。本节记录会保留。</p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => control({ action: "end" })}
          >
            确认结束课堂
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => setEnding(false)}
          >
            继续上课
          </button>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}
function StudentClassroom({ state, refresh }) {
  const { room, me } = state;
  const previous = useRef({ roomId: room.id, stage: room.stage });
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (
      previous.current.roomId === room.id &&
      previous.current.stage !== room.stage
    ) {
      setAnnouncement(
        activities[room.stage]
          ? `老师已切换到“${activities[room.stage].title}”，之前未提交的草稿已保留。`
          : "课堂状态已更新。",
      );
      window.scrollTo({ top: 0, behavior: "instant" });
    }
    previous.current = { roomId: room.id, stage: room.stage };
  }, [room.id, room.stage]);
  if (!room.pageOpen || room.stage === "waiting" || room.stage === "ended") {
    const ended = room.stage === "ended",
      closed = !room.pageOpen;
    return (
      <section className="classroom-curtain" aria-live="polite">
        <div className="curtain-icon">
          {ended ? (
            <CircleCheck size={38} />
          ) : closed ? (
            <LockKeyhole size={38} />
          ) : (
            <Monitor size={38} />
          )}
        </div>
        <span className="eyebrow">AI 共创课堂</span>
        <h1>
          {ended
            ? "本节课堂已结束"
            : closed
              ? "课堂页面暂未开放"
              : "已加入课堂，准备好出发"}
        </h1>
        <p>
          {ended
            ? "谢谢你的参与，已提交的作品都已保存。"
            : closed
              ? "请留在这里，老师开放页面后会自动更新。"
              : "请等待老师开启主题，页面会自动跟随老师切换。"}
        </p>
        {ended && (
          <span className="pill">
            你已完成 {Object.keys(state.submissions).length} 个主题
          </span>
        )}
        {me.name && (
          <p className="curtain-identity">
            {me.school} · {me.name}
          </p>
        )}
      </section>
    );
  }
  const kind = room.stage,
    submitted = !!state.submissions[kind];
  return (
    <>
      <div className="student-stage-heading">
        <div>
          <span className="eyebrow">AI 共创课堂 · 跟随老师的节奏</span>
          <h1>{activities[kind].subtitle}</h1>
        </div>
        <ol className="student-progress" aria-label="课堂主题进度">
          {Object.entries(activities).map(([key, a]) => (
            <li
              key={key}
              aria-current={kind === key ? "step" : undefined}
              className={kind === key ? "current" : ""}
            >
              <span>{a.number}</span>
              {a.title}
            </li>
          ))}
        </ol>
      </div>
      <p className="sync-notice" role="status">
        {announcement || "老师切换主题时，你的页面会自动进入相应活动。"}
      </p>
      {room.paused && (
        <p className="pause-notice" role="status">
          <Pause size={16} />
          老师暂停了填写，先听一听大家的想法。已解锁的分享仍可阅读。
        </p>
      )}
      <div className="student-split" key={`${room.id}:${me.id}:${kind}`}>
        <StudentActivity kind={kind} state={state} refresh={refresh} />
        {submitted ? (
          <Board state={state} role="student" fixedKind={kind} />
        ) : (
          <section
            className="locked-sharing"
            aria-labelledby="locked-sharing-title"
          >
            <div className="sharing-heading">
              <Users size={21} />
              <h2 id="locked-sharing-title">同学的分享</h2>
            </div>
            <div className="locked-sharing-body">
              <span className="lock-orbit">
                <LockKeyhole size={34} />
              </span>
              <h3>先写下你的想法</h3>
              <p>
                完成并提交本主题后，
                <br />
                这里会自动出现同学们的回答。
              </p>
              <span className="privacy-label">独立思考，再一起交流</span>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
function Share({ room }) {
  const [share, setShare] = useState(null),
    [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  const linkInput = useRef(null);
  useEffect(() => {
    let live = true;
    setShare(null);
    api(`/api/teacher/share?origin=${encodeURIComponent(location.origin)}`)
      .then((value) => {
        if (live) {
          setShare(value);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [room.id]);
  const copy = async () => {
    setError("");
    try {
      try {
        await navigator.clipboard.writeText(share.url);
      } catch {
        // Plain HTTP on a school LAN may not expose the Clipboard API.
        const focused = document.activeElement;
        linkInput.current.focus();
        linkInput.current.select();
        const success = document.execCommand("copy");
        focused?.focus();
        if (!success) throw new Error("Copy unavailable");
      }
      setCopied(true);
    } catch {
      setCopied(false);
      setError("请在下方选中链接后复制。");
    }
  };
  useEffect(() => {
    setCopied(false);
  }, [room.id]);
  return (
    <aside className="share-card">
      <div>
        <span className="eyebrow">学生固定链接</span>
        <strong className="share-title">打开链接，直接进入</strong>
        <p>本节课始终使用这一链接，可反复转发。</p>
        <button className="text-button" onClick={copy} disabled={!share}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? "链接已复制" : "复制学生端链接"}
        </button>
        <ErrorText>{error}</ErrorText>
      </div>
      {share && (
        <img
          src={share.qr}
          width="104"
          height="104"
          alt="学生加入课堂的二维码"
        />
      )}
      <input
        ref={linkInput}
        className="share-url"
        aria-label="学生加入链接"
        value={share?.url || "正在读取链接…"}
        readOnly
        onFocus={(e) => e.target.select()}
      />
      {share &&
        ["localhost", "127.0.0.1", "[::1]"].includes(
          new URL(share.url).hostname,
        ) && (
          <p className="local-share-note">
            此链接仅本机可用。请用校内服务器地址打开教师端后分享。
          </p>
        )}
    </aside>
  );
}
function Board({ state, role, fixedKind, refreshClassroom }) {
  const student = role === "student";
  const [selected, setSelected] = useState(
    activities[state.room.stage] ? state.room.stage : "discover",
  );
  const kind = fixedKind || selected;
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState(""),
    [page, setPage] = useState(1);
  const [school, setSchool] = useState(""),
    [checked, setChecked] = useState([]),
    [pendingDelete, setPendingDelete] = useState(null),
    [moderating, setModerating] = useState(false),
    [moderationError, setModerationError] = useState(""),
    [notice, setNotice] = useState("");
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = useRef();
  const deleteDialog = useRef();
  const schoolOptions = [
    ...new Set([...state.schools, ...(state.submissionSchools || [])]),
  ];
  const chosen = checked.filter((id) =>
    data?.rows.some((row) => row.id === id),
  );
  const allChecked = !!data?.rows.length && chosen.length === data.rows.length;
  useEffect(() => {
    if (pendingDelete) deleteDialog.current?.showModal();
    else deleteDialog.current?.close();
  }, [pendingDelete]);
  const requestModeration = (ids) => {
    setPendingDelete({
      ids,
      names: data.rows
        .filter((row) => ids.includes(row.id))
        .map((row) => row.name),
    });
  };
  const manage = async (ids) => {
    if (moderating || !ids.length) return;
    setModerating(true);
    setModerationError("");
    setNotice("");
    try {
      const result = await api("/api/teacher/submissions/moderate", {
        roomId: state.room.id,
        ids,
        action: "delete",
      });
      setChecked([]);
      setNotice(`已删除 ${result.changed} 份提交，作品正文已清除。`);
      await refresh.current?.();
      await refreshClassroom?.();
    } catch (e) {
      setModerationError(e.message);
    } finally {
      setModerating(false);
    }
  };
  useEffect(() => {
    setChecked([]);
    setPendingDelete(null);
    setNotice("");
    setModerationError("");
  }, [kind, query, school, page]);
  useEffect(() => {
    if (!student && activities[state.room.stage]) {
      setSelected(state.room.stage);
      setPage(1);
    }
  }, [state.room.stage, student]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilter(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    let active = true;
    setData(null);
    setBusy(true);
    const queue = createRefreshQueue(async () => {
      try {
        const result = await api(
          `/api/board?${new URLSearchParams({ role, kind, page: String(page), q: filter, ...(student ? { classroomId: state.room.id } : { school }) })}`,
        );
        if (active) {
          setData(result);
          setChecked((ids) =>
            ids.filter((id) => result.rows.some((row) => row.id === id)),
          );
          setError("");
        }
      } catch (e) {
        if (active) {
          setData(null);
          setError(e.message);
        }
      } finally {
        if (active) setBusy(false);
      }
    });
    refresh.current = () => queue.update();
    queue.update();
    return () => {
      active = false;
      queue.stop();
    };
  }, [role, kind, page, filter, school, state.room.id]);
  useEffect(() => {
    refresh.current?.();
  }, [state]);
  return (
    <section
      className={`board ${student ? "forum-board" : ""}`}
      aria-labelledby="board-title"
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            {student
              ? "THINK FIRST, SHARE TOGETHER"
              : "ALL CLASSROOM RESPONSES"}
          </span>
          <h2 id="board-title">
            {student ? "同学的分享" : "全班提交记录"}
            <span className="total-badge">{state.counts[kind]}</span>
          </h2>
          <p>
            {student
              ? "你已完成本主题，现在可以看看大家的想法。"
              : "按主题、学校或关键词定位提交；删除后学生端同步移除，作品正文永久清除。"}
          </p>
        </div>
      </div>
      <div className="board-toolbar">
        {!student && (
          <div className="tabs" role="tablist" aria-label="查看哪个主题的提交">
            {Object.entries(activities).map(([key, a]) => (
              <button
                key={key}
                id={`tab-${key}`}
                role="tab"
                aria-selected={kind === key}
                aria-controls="board-panel"
                disabled={moderating}
                className={kind === key ? "active" : ""}
                onClick={() => {
                  setSelected(key);
                  setPage(1);
                }}
              >
                {a.title}
                <span>{state.counts[key]}</span>
              </button>
            ))}
          </div>
        )}
        <label className="search-input">
          <Search size={17} />
          <input
            aria-label="搜索同学分享"
            placeholder="搜索姓名、学校或内容"
            maxLength={80}
            value={query}
            disabled={moderating}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {!student && (
        <div className="moderation-toolbar">
          <label>
            学校
            <select
              aria-label="按学校筛选"
              value={school}
              disabled={moderating}
              onChange={(e) => {
                setSchool(e.target.value);
                setPage(1);
              }}
            >
              <option value="">全部学校</option>
              {schoolOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <div className="selection-actions">
            <span>已选 {chosen.length} 份</span>
            <button
              className="secondary delete-action"
              disabled={!chosen.length || moderating || busy}
              onClick={() => requestModeration(chosen)}
            >
              <Trash2 size={16} />
              {moderating ? "正在处理…" : "删除所选"}
            </button>
          </div>
        </div>
      )}
      {!student && (
        <p className="moderation-notice" role="status">
          {notice ||
            "可勾选本页批量删除，也可在每行右侧单独处理。删除后不计入统计和导出，且不可恢复。"}
        </p>
      )}
      <ErrorText>{moderationError}</ErrorText>
      <ErrorText>{error}</ErrorText>
      {!student && (
        <dialog
          className="delete-dialog"
          ref={deleteDialog}
          aria-labelledby="delete-confirm-title"
          onCancel={(e) => {
            e.preventDefault();
            setPendingDelete(null);
          }}
        >
          <h3 id="delete-confirm-title">确认删除提交</h3>
          <p>
            即将删除“一起{kind === "discover" ? "发现" : "设计"}”中的{" "}
            {pendingDelete?.ids.length || 0} 份提交：
          </p>
          <p className="delete-names">{pendingDelete?.names.join("、")}</p>
          <p>
            作品正文将永久清除，学生端同步移除，统计和导出也不再包含这些内容。删除后不可恢复。
          </p>
          <div className="dialog-actions">
            <button
              className="secondary"
              autoFocus
              onClick={() => setPendingDelete(null)}
            >
              取消
            </button>
            <button
              className="primary confirm-delete"
              onClick={() => {
                if (!pendingDelete) return;
                const ids = pendingDelete.ids;
                setPendingDelete(null);
                manage(ids);
              }}
            >
              确认删除
            </button>
          </div>
        </dialog>
      )}
      <div
        id="board-panel"
        role={student ? "region" : "tabpanel"}
        aria-label={student ? "当前主题的同学分享" : undefined}
        aria-labelledby={student ? undefined : `tab-${kind}`}
        aria-busy={busy}
      >
        {student ? (
          <div className="forum-rows">
            {data?.rows.map((row) => (
              <article
                className={`forum-row ${row.participantId === state.me.id ? "my-post" : ""}`}
                key={row.id}
                aria-label={`${row.name}的分享`}
              >
                <header>
                  <span className="student-avatar" aria-hidden="true">
                    {row.name.slice(0, 1)}
                  </span>
                  <div>
                    <strong>{row.name}</strong>
                    {row.participantId === state.me.id && (
                      <span className="own-post">我</span>
                    )}
                    <p>{row.school}</p>
                  </div>
                  <time dateTime={new Date(row.createdAt).toISOString()}>
                    {new Date(row.createdAt).toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Asia/Shanghai",
                    })}
                  </time>
                </header>
                {kind === "discover" && (
                  <span className="field-chip">{row.field}</span>
                )}
                <dl>
                  <dt>{kind === "discover" ? "应用场景" : "场景"}</dt>
                  <dd>{row.scenario}</dd>
                  <dt>{kind === "discover" ? "价值" : "基本功能"}</dt>
                  <dd>{kind === "discover" ? row.value : row.function}</dd>
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <div
            className="table-scroll"
            tabIndex="0"
            role="region"
            aria-label={`${activities[kind].title}提交列表，可左右滚动`}
          >
            <table>
              <thead>
                <tr>
                  <th className="select-column">
                    <input
                      type="checkbox"
                      aria-label="选择本页全部提交"
                      checked={allChecked}
                      disabled={moderating || busy || !data?.rows.length}
                      ref={(el) => {
                        if (el)
                          el.indeterminate = chosen.length > 0 && !allChecked;
                      }}
                      onChange={(e) =>
                        setChecked(
                          e.target.checked
                            ? data.rows.map((row) => row.id)
                            : [],
                        )
                      }
                    />
                  </th>
                  <th className="index-column">序号</th>
                  <th className="person-column">姓名</th>
                  <th className="school-column">学校</th>
                  {kind === "discover" && (
                    <th className="field-column">领域</th>
                  )}
                  <th>{kind === "discover" ? "应用场景" : "场景"}</th>
                  <th>{kind === "discover" ? "价值" : "基本功能"}</th>
                  <th className="action-column">操作</th>
                </tr>
              </thead>
              <tbody>
                {data?.rows.map((row, index) => (
                  <tr
                    key={row.id}
                    className={chosen.includes(row.id) ? "selected-row" : ""}
                  >
                    <td className="select-column">
                      <input
                        type="checkbox"
                        aria-label={`选择${row.name}的提交`}
                        checked={chosen.includes(row.id)}
                        disabled={moderating || busy}
                        onChange={(e) =>
                          setChecked((ids) =>
                            e.target.checked
                              ? [...ids, row.id]
                              : ids.filter((id) => id !== row.id),
                          )
                        }
                      />
                    </td>
                    <td className="row-index">
                      {data.total - ((data.page - 1) * 50 + index)}
                    </td>
                    <td className="person-cell">{row.name}</td>
                    <td>{row.school}</td>
                    {kind === "discover" && (
                      <td>
                        <span className="field-chip">{row.field}</span>
                      </td>
                    )}
                    <td>{row.scenario}</td>
                    <td>{kind === "discover" ? row.value : row.function}</td>
                    <td className="action-column">
                      <button
                        className="delete-action"
                        aria-label={`删除${row.name}的提交`}
                        disabled={moderating || busy}
                        onClick={() => requestModeration([row.id])}
                      >
                        <Trash2 size={15} />
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(!data || !data.rows.length) && (
          <div className="empty-board">
            <Users size={29} />
            <strong>
              {busy
                ? "正在读取课堂想法…"
                : error
                  ? "分享暂时不可用"
                  : filter || school
                    ? "没有找到匹配的内容"
                    : "暂无可展示的作品"}
            </strong>
            <p>
              {filter || school
                ? "试试其他姓名、学校或关键词。"
                : "提交的作品会在这里自动更新。"}
            </p>
          </div>
        )}
      </div>
      <div className="board-footer">
        <span aria-live="polite">
          {data
            ? `共 ${data.total} 份${filter || school ? "匹配的" : ""}分享`
            : "正在读取"}{" "}
          · 每页最多 50 份
        </span>
        {data && data.pages > 1 && (
          <div className="pagination">
            <button
              aria-label="上一页"
              disabled={moderating || data.page <= 1}
              onClick={() => setPage(data.page - 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              {data.page} / {data.pages}
            </span>
            <button
              aria-label="下一页"
              disabled={moderating || data.page >= data.pages}
              onClick={() => setPage(data.page + 1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
function ClassroomTools({ state, refresh }) {
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const reset = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/api/teacher/new-room", { roomId: state.room.id });
      await refresh();
      setConfirm(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="classroom-tools">
      <summary>课堂工具</summary>
      <div className="tools-content">
        <a className="secondary" href="/api/teacher/export">
          <Download size={16} />
          导出本节记录 CSV
        </a>
        <button className="secondary" onClick={() => setConfirm((v) => !v)}>
          开始新一节课
        </button>
        {confirm && (
          <div className="reset-confirm">
            <p>
              新课堂会生成自己的固定链接，需要重新分享。旧链接继续对应已结束的课堂，旧记录保留在数据库中；请先导出需要的记录。
            </p>
            <button
              className="primary"
              disabled={
                busy || (state.room.pageOpen && state.room.stage !== "ended")
              }
              onClick={reset}
            >
              确认开始新课堂
            </button>
            <button className="text-button" onClick={() => setConfirm(false)}>
              取消
            </button>
            {state.room.pageOpen && state.room.stage !== "ended" && (
              <p>请先结束课堂或关闭课堂页面。</p>
            )}
          </div>
        )}
        <ErrorText>{error}</ErrorText>
      </div>
    </details>
  );
}
export default function App() {
  const teacher = location.pathname.startsWith("/teacher"),
    role = teacher ? "teacher" : "student",
    classroomId =
      location.pathname.match(/^\/classroom\/([^/]+)\/?$/)?.[1] || "";
  const { state, loading, error, ended, connection, refresh } = useClassroom(
    role,
    classroomId,
  );
  const [logoutError, setLogoutError] = useState("");
  const logout = async () => {
    try {
      await api("/api/logout", {});
      await refresh();
    } catch (e) {
      setLogoutError(e.message);
    }
  };
  return (
    <>
      <Header
        teacher={teacher}
        state={state}
        connection={connection}
        onLogout={logout}
      />
      {loading ? (
        <main className="loading" role="status">
          正在连接课堂…
        </main>
      ) : !state ? (
        <>
          {teacher ? (
            <>
              <TeacherEntry refresh={refresh} />
              <ErrorText>{error}</ErrorText>
            </>
          ) : (
            <StudentEntrance ended={ended} error={error} refresh={refresh} />
          )}
        </>
      ) : (
        <main
          className={`workspace ${teacher ? "teacher-workspace" : "student-workspace"}`}
        >
          <ErrorText>{error || logoutError}</ErrorText>
          {teacher ? (
            <>
              <section className="classroom-intro teacher-intro">
                <div>
                  <span className="eyebrow">
                    TEACHER WORKSPACE · 教师工作台
                  </span>
                  <h1>
                    老师推进，<span>全班同屏。</span>
                  </h1>
                  <p>
                    选择当前主题，学生自动进入同一页面；先独立作答，再一起分享。
                  </p>
                  <div className="classroom-stats">
                    <span>
                      <Users size={16} />
                      <strong>{state.counts.joined}</strong> 人已加入
                    </span>
                    <span>
                      <strong>{state.counts.discover}</strong> 次发现
                    </span>
                    <span>
                      <strong>{state.counts.design}</strong> 个设计
                    </span>
                  </div>
                </div>
                <Share room={state.room} />
              </section>
              <TeacherControls state={state} refresh={refresh} />
              <Board
                key={state.room.id}
                state={state}
                role="teacher"
                refreshClassroom={refresh}
              />
              <ClassroomTools state={state} refresh={refresh} />
            </>
          ) : (
            <StudentClassroom
              key={state.room.id}
              state={state}
              refresh={refresh}
            />
          )}
        </main>
      )}
      <footer className="site-footer">
        <span>AI 共创课堂</span>
        <span>先独立思考，再分享发现。</span>
      </footer>
    </>
  );
}

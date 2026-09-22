import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Lightbulb,
  LogOut,
  Search,
  Sparkles,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { api } from "./api.js";
import { createRefreshQueue } from "./refresh-queue.js";

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
function useClassroom(role) {
  const [state, setState] = useState(null),
    [loading, setLoading] = useState(true);
  const [error, setError] = useState(""),
    [connected, setConnected] = useState(false);
  const queue = useRef();
  useEffect(() => {
    let active = true;
    queue.current = createRefreshQueue(async () => {
      try {
        const result = await api(`/api/session?role=${role}`);
        if (active) {
          setState(result.state);
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
  }, [role]);
  const authenticated = !!state;
  useEffect(() => {
    if (!authenticated) return;
    const events = new EventSource(`/api/events?role=${role}`);
    const update = () => queue.current.update();
    events.addEventListener("ready", () => {
      setConnected(true);
      update();
    });
    events.addEventListener("update", update);
    events.onerror = () => setConnected(false);
    const timer = setInterval(update, 6000 + Math.random() * 1500);
    const visible = () => {
      if (document.visibilityState === "visible") update();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      events.close();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      setConnected(false);
    };
  }, [authenticated, role]);
  return {
    state,
    loading,
    error,
    connected,
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
function Header({ teacher, state, connected, onLogout }) {
  return (
    <header className="site-header">
      <a className="brand" href={teacher ? "/teacher" : "/"}>
        <span className="brand-mark">
          <Sparkles size={23} />
        </span>
        <span>
          AI 共创课堂<small>发现 · 思考 · 创造</small>
        </span>
      </a>
      <div className="header-right">
        {state ? (
          <span className={`connection ${connected ? "" : "reconnecting"}`}>
            {connected ? <Wifi size={15} /> : <WifiOff size={15} />}
            {connected ? "课堂实时同步" : "正在恢复实时连接"}
          </span>
        ) : (
          <span className="header-note">人工智能通识课</span>
        )}
        {teacher && state ? (
          <button className="text-button" onClick={onLogout}>
            <LogOut size={15} />
            退出
          </button>
        ) : (
          <a className="role-link" href={teacher ? "/" : "/teacher"}>
            {teacher ? "学生入口" : "教师入口"}
            <ArrowRight size={14} />
          </a>
        )}
      </div>
    </header>
  );
}
function Entry({ teacher, refresh }) {
  const [value, setValue] = useState(() =>
    teacher ? "" : new URLSearchParams(location.search).get("code") || "",
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(
        teacher ? "/api/login" : "/api/join",
        teacher ? { password: value } : { code: value.trim() },
      );
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
        <span className="pill">{teacher ? "教师工作台" : "欢迎来到课堂"}</span>
        <h2>{teacher ? "准备好，一起出发" : "加入我们的共创"}</h2>
        <p>
          {teacher
            ? "登录后，分别控制两个固定环节的开放。"
            : "输入老师提供的 6 位课堂码，即可参与。"}
        </p>
        <form onSubmit={submit}>
          <label htmlFor="entry-value">{teacher ? "教师密码" : "课堂码"}</label>
          <input
            id="entry-value"
            type={teacher ? "password" : "text"}
            inputMode={teacher ? undefined : "numeric"}
            autoComplete={teacher ? "current-password" : "off"}
            className={teacher ? "" : "code-input"}
            maxLength={teacher ? 128 : 6}
            pattern={teacher ? undefined : "[0-9]{6}"}
            placeholder={teacher ? "请输入教师密码" : "000000"}
            value={value}
            required
            onChange={(e) =>
              setValue(
                teacher ? e.target.value : e.target.value.replace(/\D/g, ""),
              )
            }
          />
          <ErrorText>{error}</ErrorText>
          <button className="primary wide" disabled={busy}>
            {busy ? "正在进入…" : teacher ? "进入教师工作台" : "加入课堂"}
            <ArrowRight size={18} />
          </button>
        </form>
        <p className="fine-print">
          {teacher
            ? "首次启动时，教师密码显示在服务终端中。"
            : "无需注册账号。提交的学校、姓名和作品会在本课堂中相互可见。"}
        </p>
      </section>
    </main>
  );
}
function ActivityTitle({ kind, open, submitted }) {
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
  const { room, me, submissions, schools } = state,
    submitted = submissions[kind],
    open = room[`${kind}Open`];
  const [draft, change] = useDraft(
    `ai-workshop:${room.id}:${me.id}:${kind}`,
    kind === "discover" ? emptyDiscovery : emptyDesign,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const prerequisite = kind === "design" && !submissions.discover;
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/api/student/submit/${kind}`, draft);
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
      <ActivityTitle kind={kind} open={open} submitted={submitted} />
      {submitted ? (
        <div className="submitted-content">
          <div className="saved-title">
            <Check size={18} />
            {kind === "discover" ? "第一次提交成功" : "第二次提交成功"}
          </div>
          <p className="identity">
            {me.school}
            <span>·</span>
            {me.name}
          </p>
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
          <p className="saved-hint">
            已加入下方共享列表，其他同学可以看到你的想法。
          </p>
        </div>
      ) : (
        <form onSubmit={submit}>
          <fieldset disabled={!open || prerequisite || busy}>
            {kind === "discover" ? (
              <>
                <div className="field-pair">
                  <Field id="discover-school" label="学校">
                    <select
                      id="discover-school"
                      value={draft.school}
                      onChange={(e) => change("school", e.target.value)}
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
                    {...editable("name")}
                    label="姓名"
                    maxLength={40}
                    placeholder="你的姓名"
                  />
                </div>
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
                <p className="identity">
                  {me.name
                    ? `${me.school} · ${me.name}`
                    : "学校和姓名将沿用第一次提交的信息"}
                </p>
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
                  <p>
                    大胆想象，也想一想：
                    <br />
                    这个设计能为谁解决什么问题？
                  </p>
                </div>
              </>
            )}
            <button
              className={`primary wide ${kind === "design" ? "warm" : ""}`}
              disabled={!open || prerequisite || busy}
            >
              {busy
                ? "正在提交…"
                : kind === "discover"
                  ? "第一次提交"
                  : "第二次提交"}
              <ArrowRight size={17} />
            </button>
          </fieldset>
          <ErrorText>{error}</ErrorText>
          <p className="form-hint">
            {prerequisite
              ? "先完成“一起发现”，再开始第二次提交。"
              : !open
                ? "老师开放本环节后，就可以填写并提交。"
                : "每个环节提交一次，提交后全班可见。"}
          </p>
        </form>
      )}
    </article>
  );
}
function TeacherControls({ state, refresh }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const control = async (kind) => {
    setBusy(true);
    setError("");
    try {
      await api("/api/teacher/control", {
        roomId: state.room.id,
        kind,
        open: !state.room[`${kind}Open`],
      });
      await refresh();
    } catch (e) {
      setError(e.message);
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <section className="activities teacher-activities">
        {Object.entries(activities).map(([kind]) => {
          const open = state.room[`${kind}Open`];
          return (
            <article className={`activity ${kind}`} key={kind}>
              <ActivityTitle kind={kind} open={open} />
              <div className="control-bottom">
                <span>
                  <strong>{state.counts[kind]}</strong> 份提交
                </span>
                <button
                  role="switch"
                  aria-checked={open}
                  aria-label={`${activities[kind].title}提交开关`}
                  className={`switch-button ${open ? "is-on" : ""}`}
                  disabled={busy}
                  onClick={() => control(kind)}
                >
                  <span className="switch-track">
                    <span />
                  </span>
                  {open ? "关闭提交" : "开放提交"}
                </button>
              </div>
              <p className="control-hint">
                {kind === "discover"
                  ? "学校、姓名、领域、应用场景、价值"
                  : "场景、基本功能 · 沿用第一次提交的身份信息"}
              </p>
            </article>
          );
        })}
      </section>
      <ErrorText>{error}</ErrorText>
    </>
  );
}
function Share({ room }) {
  const [share, setShare] = useState(null),
    [copied, setCopied] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setShare(null);
    api("/api/teacher/share")
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
    try {
      await navigator.clipboard.writeText(share.url);
      setCopied(true);
    } catch {
      setError("请在下方选中链接后复制。");
    }
  };
  useEffect(() => {
    setCopied(false);
  }, [room.id]);
  return (
    <aside className="share-card">
      <div>
        <span className="eyebrow">本节课堂码</span>
        <strong className="room-code">{room.code}</strong>
        <p>打开学生页面，输入课堂码加入</p>
        <button className="text-button" onClick={copy} disabled={!share}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? "链接已复制" : "复制学生链接"}
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
        className="share-url"
        aria-label="学生加入链接"
        value={share?.url || "正在生成链接…"}
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
function Board({ state, role }) {
  const [kind, setKind] = useState("discover"),
    [query, setQuery] = useState("");
  const [filter, setFilter] = useState(""),
    [page, setPage] = useState(1);
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = useRef();
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
          `/api/board?${new URLSearchParams({ role, kind, page: String(page), q: filter })}`,
        );
        if (active) {
          setData(result);
          setError("");
        }
      } catch (e) {
        if (active) setError(e.message);
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
  }, [role, kind, page, filter, state.room.id]);
  useEffect(() => {
    refresh.current?.();
  }, [state]);
  const total = state.counts.discover + state.counts.design;
  return (
    <section className="board" aria-labelledby="board-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">OUR IDEAS, TOGETHER</span>
          <h2 id="board-title">
            让每一个想法被看见<span className="total-badge">{total}</span>
          </h2>
          <p>提交后自动更新，全班共享。最新的想法排在最前面。</p>
        </div>
        <span className="board-live">
          <span />
          课堂共享列表
        </span>
      </div>
      <div className="board-toolbar">
        <div className="tabs" role="tablist" aria-label="查看哪个环节的提交">
          {Object.entries(activities).map(([key, a]) => (
            <button
              key={key}
              id={`tab-${key}`}
              role="tab"
              aria-selected={kind === key}
              aria-controls="board-panel"
              className={kind === key ? "active" : ""}
              onClick={() => {
                setKind(key);
                setPage(1);
              }}
            >
              {a.title}
              <span>{state.counts[key]}</span>
            </button>
          ))}
        </div>
        <label className="search-input">
          <Search size={17} />
          <input
            aria-label="搜索共享列表"
            placeholder="搜索姓名、学校或内容"
            maxLength={80}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <ErrorText>{error}</ErrorText>
      <div
        id="board-panel"
        role="tabpanel"
        aria-labelledby={`tab-${kind}`}
        aria-busy={busy}
      >
        <div
          className="table-scroll"
          tabIndex="0"
          role="region"
          aria-label={`${activities[kind].title}共享列表，可左右滚动`}
        >
          <table>
            <thead>
              <tr>
                <th className="index-column">序号</th>
                <th className="person-column">姓名</th>
                <th className="school-column">学校</th>
                {kind === "discover" && <th className="field-column">领域</th>}
                <th>{kind === "discover" ? "应用场景" : "场景"}</th>
                <th>{kind === "discover" ? "价值" : "基本功能"}</th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((row, index) => (
                <tr
                  key={row.id}
                  className={row.participantId === state.me?.id ? "my-row" : ""}
                >
                  <td className="row-index">
                    {data.total - ((data.page - 1) * 50 + index)}
                  </td>
                  <td className="person-cell">
                    {row.name}
                    {row.participantId === state.me?.id && <small>我</small>}
                  </td>
                  <td>{row.school}</td>
                  {kind === "discover" && (
                    <td>
                      <span className="field-chip">{row.field}</span>
                    </td>
                  )}
                  <td>{row.scenario}</td>
                  <td>{kind === "discover" ? row.value : row.function}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(!data || !data.rows.length) && (
          <div className="empty-board">
            <Users size={29} />
            <strong>
              {busy
                ? "正在读取课堂想法…"
                : filter
                  ? "没有找到匹配的内容"
                  : "这里，等着大家的第一个想法"}
            </strong>
            <p>
              {filter
                ? "试试其他姓名、学校或关键词。"
                : "完成上方活动并提交，作品就会一行一行地出现在这里。"}
            </p>
          </div>
        )}
      </div>
      <div className="board-footer">
        <span aria-live="polite">
          {data
            ? `共 ${data.total} 份${filter ? "匹配的" : ""}提交`
            : "正在读取"}{" "}
          · 每页最多 50 行
        </span>
        {data && data.pages > 1 && (
          <div className="pagination">
            <button
              aria-label="上一页"
              disabled={data.page <= 1}
              onClick={() => setPage(data.page - 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              {data.page} / {data.pages}
            </span>
            <button
              aria-label="下一页"
              disabled={data.page >= data.pages}
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
              开始新课堂会更换课堂码，让当前学生重新加入。旧记录保留在数据库中；当前页面只展示新课堂，请先导出需要的记录。
            </p>
            <button
              className="primary"
              disabled={
                busy || state.room.discoverOpen || state.room.designOpen
              }
              onClick={reset}
            >
              确认开始新课堂
            </button>
            <button className="text-button" onClick={() => setConfirm(false)}>
              取消
            </button>
            {(state.room.discoverOpen || state.room.designOpen) && (
              <p>请先关闭两个环节。</p>
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
    role = teacher ? "teacher" : "student";
  const { state, loading, error, connected, refresh } = useClassroom(role);
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
        connected={connected}
        onLogout={logout}
      />
      {loading ? (
        <main className="loading" role="status">
          正在连接课堂…
        </main>
      ) : !state ? (
        <>
          <Entry teacher={teacher} refresh={refresh} />
          <ErrorText>{error}</ErrorText>
        </>
      ) : (
        <main className="workspace">
          <ErrorText>{error || logoutError}</ErrorText>
          <section
            className={`classroom-intro ${teacher ? "teacher-intro" : ""}`}
          >
            <div>
              <span className="eyebrow">
                {teacher
                  ? "TEACHER WORKSPACE · 教师工作台"
                  : `AI EXPLORATION LAB · 课堂 ${state.room.code}`}
              </span>
              <h1>
                {teacher ? (
                  <>
                    一堂课，<span>两次共创。</span>
                  </>
                ) : (
                  <>
                    从身边的发现，<span>走向未来的设计。</span>
                  </>
                )}
              </h1>
              <p>
                {teacher
                  ? "按课堂节奏开放两个环节，和同学们一起看见想法的生长。"
                  : "先记录你发现的 AI 应用，再设计你期待的未来。"}
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
            {teacher && <Share room={state.room} />}
          </section>
          {teacher && state.schools.includes("待补充学校") && (
            <p className="school-notice">
              学校名单待补充，当前下拉选项为“待补充学校”。
            </p>
          )}
          {teacher ? (
            <TeacherControls state={state} refresh={refresh} />
          ) : (
            <section className="activities">
              {["discover", "design"].map((kind) => (
                <StudentActivity
                  key={`${state.room.id}:${state.me.id}:${kind}`}
                  kind={kind}
                  state={state}
                  refresh={refresh}
                />
              ))}
            </section>
          )}
          <Board state={state} role={role} />
          {teacher && <ClassroomTools state={state} refresh={refresh} />}
        </main>
      )}
      <footer className="site-footer">
        <span>AI 共创课堂</span>
        <span>好奇心，让未来从这里发生。</span>
      </footer>
    </>
  );
}

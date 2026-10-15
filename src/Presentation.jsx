import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Plus,
  Pencil,
  Trash2,
  Play,
  X,
  Check,
  CheckCheck,
  CircleHelp,
  Cloud,
  LockKeyhole,
  Maximize,
  Minimize,
  Monitor,
  PieChart,
  Sparkles,
  Users,
} from "lucide-react";
import { api } from "./api.js";
import { createRefreshQueue } from "./refresh-queue.js";
import {
  presentationKinds,
  classroomActivities,
  maxActivities,
  activityNames,
  splitWords,
} from "../shared/activities.js";
import { layoutWords } from "./word-layout.js";
import "./presentation.css";

const colors = [
  "#257666",
  "#d98159",
  "#788ccb",
  "#d8ac4c",
  "#9c75a7",
  "#65a2ac",
];
const descriptions = {
  judge: "想一想，作出你的判断",
  choice: "选一选，看见不同的想法",
  wordcloud: "写下关键词，让灵感在这里相遇",
};
const icons = { judge: CheckCheck, choice: PieChart, wordcloud: Cloud };
const percentage = (value) => `${Number(value.toFixed(1))}%`;

function SlideFrame({ children }) {
  const viewport = useRef();
  const [scale, setScale] = useState(1);
  useEffect(() => {
    document.body.classList.add("presentation-body");
    const observer = new ResizeObserver(([entry]) => {
      setScale(
        Math.min(
          entry.contentRect.width / 1440,
          entry.contentRect.height / 810,
        ),
      );
    });
    observer.observe(viewport.current);
    return () => {
      observer.disconnect();
      document.body.classList.remove("presentation-body");
    };
  }, []);
  return (
    <main ref={viewport} className="slide-viewport" aria-label="16:9 课堂展示">
      <div
        className="slide-fit"
        style={{ width: 1440 * scale, height: 810 * scale }}
      >
        <div className="slide-stage" style={{ transform: `scale(${scale})` }}>
          {children}
        </div>
      </div>
    </main>
  );
}

function PieResults({ data }) {
  let angle = -Math.PI / 2;
  return (
    <>
      <svg
        className="response-pie"
        viewBox="0 0 420 420"
        role="img"
        aria-label={`全班选择比例，共 ${data.total} 人提交`}
      >
        <title>
          {data.options
            .map(
              (item) =>
                `${item.label}：${item.count} 人，${percentage(item.percentage)}`,
            )
            .join("；")}
        </title>
        {!data.total && <circle cx="210" cy="210" r="178" fill="#edf1ef" />}
        {data.options.map((item, index) => {
          if (!item.count || !data.total) return null;
          const fraction = item.count / data.total,
            start = angle,
            end = start + fraction * Math.PI * 2;
          angle = end;
          const point = (a, r = 178) => [
            210 + r * Math.cos(a),
            210 + r * Math.sin(a),
          ];
          const [x, y] = point((start + end) / 2, 112);
          return (
            <g key={item.id}>
              {fraction === 1 ? (
                <circle cx="210" cy="210" r="178" fill={colors[index]} />
              ) : (
                <path
                  d={`M 210 210 L ${point(start).join(" ")} A 178 178 0 ${fraction > 0.5 ? 1 : 0} 1 ${point(end).join(" ")} Z`}
                  fill={colors[index]}
                  stroke="#fff"
                  strokeWidth="4"
                />
              )}
              {fraction >= 0.08 && (
                <text
                  x={fraction === 1 ? 210 : x}
                  y={fraction === 1 ? 210 : y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#fff"
                  fontSize="26"
                  fontWeight="700"
                >
                  {percentage(item.percentage)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <ul className="pie-legend" aria-label="选项人数与比例">
        {data.options.map((item, index) => (
          <li key={item.id}>
            <i style={{ background: colors[index] }} aria-hidden="true" />
            <span className="legend-label" title={item.label}>
              {item.id.length === 1 ? `${item.id} · ` : ""}
              {item.label}
            </span>
            <span className="legend-number">
              <strong>{percentage(item.percentage)}</strong>
              <small>{item.count} 人</small>
            </span>
          </li>
        ))}
      </ul>
      <p className="pie-caption">比例四舍五入，合计可能略有偏差</p>
    </>
  );
}

function WordCloud({ data }) {
  const [fontReady, setFontReady] = useState(0);
  useEffect(() => {
    let active = true;
    document.fonts?.ready.then(() => {
      if (active) setFontReady(1);
    });
    return () => {
      active = false;
    };
  }, []);
  const words = useMemo(() => {
    const context = document.createElement("canvas").getContext("2d");
    return layoutWords(data.words, (text, size) => {
      context.font = `600 ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`;
      return context.measureText(text).width;
    });
  }, [data.words, fontReady]);
  return (
    <>
      <svg
        className="response-cloud"
        viewBox="0 0 640 410"
        role="img"
        aria-label={`全班词云，${data.uniqueWords} 个不同的词，词越大提交人数越多`}
      >
        <title>
          {data.words.map((word) => `${word.text} ${word.count} 人`).join("；")}
        </title>
        {words.map((word, i) => (
          <text
            key={word.text}
            x={word.x}
            y={word.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={word.size}
            fontWeight="600"
            fill={colors[i % colors.length]}
          >
            <title>
              {word.text} · {word.count} 人
            </title>
            {word.text}
          </text>
        ))}
      </svg>
      <p className="cloud-caption">
        词越大，想到它的人越多
        <span>
          展示 {words.length} / {data.uniqueWords} 个词
          {words.length < data.uniqueWords ? " · 优先高频词" : ""}
        </span>
      </p>
    </>
  );
}

export function ActivityResults(props) {
  return (
    <ResultsPanel
      key={`${props.state.room.id}:${props.activityId || props.kind}:${props.role}`}
      {...props}
    />
  );
}

function ResultsPanel({ state, kind, activityId = kind, role = "student" }) {
  const [data, setData] = useState(null),
    [error, setError] = useState("");
  const refresh = useRef();
  useEffect(() => {
    let active = true;
    setData(null);
    const queue = createRefreshQueue(async () => {
      try {
        const result = await api(
          `/api/results?${new URLSearchParams({ kind: activityId, role, classroomId: state.room.id })}`,
        );
        if (active) {
          setData(result);
          setError("");
        }
      } catch (e) {
        if (active) {
          if ([401, 403, 404, 410].includes(e.status)) setData(null);
          setError(e.message);
        }
      }
    });
    refresh.current = () => queue.update();
    queue.update();
    return () => {
      active = false;
      queue.stop();
    };
  }, [activityId, role, state.room.id]);
  useEffect(() => {
    refresh.current?.();
  }, [state.room.dataRevision, state.room.revision]);
  return (
    <section className={`slide-results ${kind}`} aria-label="全班结果">
      <div className="results-heading">
        <div>
          <span className="slide-kicker">OUR IDEAS</span>
          <h2>{kind === "wordcloud" ? "全班的灵感词云" : "看看大家怎么选"}</h2>
        </div>
        <span className="response-count">
          <Users size={17} /> {data?.total ?? "—"} 人
        </span>
      </div>
      {error && (
        <p className="slide-error" role="alert">
          {error}
          <button onClick={() => refresh.current?.()}>重试</button>
        </p>
      )}
      {!data ? (
        <div className="results-placeholder" role="status">
          {error ? "结果暂时无法更新" : "正在汇总全班结果…"}
        </div>
      ) : !data.total ? (
        <div className="results-placeholder">暂无有效提交</div>
      ) : kind === "wordcloud" ? (
        <WordCloud data={data} />
      ) : (
        <PieResults data={data} />
      )}
    </section>
  );
}

function LockedResults({ kind }) {
  return (
    <section
      className="slide-results results-locked"
      aria-label="提交后查看全班结果"
    >
      <div className="results-heading">
        <div>
          <span className="slide-kicker">THINK FIRST, SHARE TOGETHER</span>
          <h2>{kind === "wordcloud" ? "全班的灵感词云" : "看看大家怎么选"}</h2>
        </div>
        <LockKeyhole size={22} />
      </div>
      <div className="locked-center">
        <div className="locked-orbits">
          <LockKeyhole size={42} />
        </div>
        <h3>先给出你的答案</h3>
        <p>
          提交之后，{kind === "wordcloud" ? "全班词云" : "选择比例"}
          将在这里出现。
        </p>
        <span>每一个独立的想法，都值得被看见。</span>
      </div>
      <div className="locked-foot">
        <span>01 独立思考</span>
        <ArrowRight size={16} />
        <span>02 提交答案</span>
        <ArrowRight size={16} />
        <span>03 看见全班</span>
      </div>
    </section>
  );
}

function AnswerPanel({ state, activity, index, total, refresh }) {
  const { id: activityId, kind } = activity;
  const settings = activity,
    submitted = state.submissions[activityId];
  const draftKey = `slide-draft:${state.room.id}:${state.me.id}:${activityId}:${settings.revision}`;
  const [draft, setDraft] = useState(() => {
    try {
      return (
        JSON.parse(sessionStorage.getItem(draftKey)) || {
          name: "",
          school: "",
          answer: "",
          words: "",
        }
      );
    } catch {
      return { name: "", school: "", answer: "", words: "" };
    }
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const update = (field, value) =>
    setDraft((current) => ({ ...current, [field]: value }));
  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {}
  }, [draft, draftKey]);
  const blocked = state.room.paused || busy;
  const Icon = icons[kind];
  const words = splitWords(draft.words || "");
  const wordError =
    words.length > 3
      ? "最多填写 3 个词，请删去多余的词。"
      : words.some((word) => [...word].length > 12)
        ? "每个词最多 12 个字，请缩短后再提交。"
        : "";
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(
        `/api/student/submit/${activityId}?classroomId=${state.room.id}`,
        {
          ...(!state.me.name ? { name: draft.name, school: draft.school } : {}),
          activityRevision: settings.revision,
          ...(kind === "wordcloud"
            ? { words: draft.words }
            : { answer: draft.answer }),
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
  return (
    <section className="slide-answer" aria-labelledby="slide-question">
      <div className="answer-kind">
        <span>
          <Icon size={20} /> {activityNames[kind]}
          {kind === "choice" ? " · 单选" : ""}
        </span>
        <span>
          {String(index + 1).padStart(2, "0")} /{" "}
          {String(total).padStart(2, "0")}
        </span>
      </div>
      <h1
        id="slide-question"
        className={settings.question.length > 38 ? "long-question" : ""}
      >
        {settings.question}
      </h1>
      {submitted ? (
        <div className="submitted-answer" role="status">
          <span
            className={`submitted-icon ${submitted.removed ? "removed" : ""}`}
          >
            {submitted.removed ? <CircleHelp size={34} /> : <Check size={36} />}
          </span>
          <h2>
            {submitted.removed
              ? "这份提交已被老师移除"
              : "你的想法，已加入全班"}
          </h2>
          {submitted.removed ? (
            <p>如有疑问，请联系老师。</p>
          ) : kind === "wordcloud" ? (
            <div className="submitted-words">
              {submitted.words.map((word) => (
                <span key={word}>{word}</span>
              ))}
            </div>
          ) : (
            <p className="own-answer">
              你选择了「
              {
                settings.options.find(
                  (option) => option.id === submitted.answer,
                )?.label
              }
              」
            </p>
          )}
          <p>右侧结果会随大家的提交自动更新。</p>
          <div className="submitted-identity">
            {state.me.school}
            <br />
            {state.me.name}
          </div>
        </div>
      ) : (
        <form className="slide-answer-form" onSubmit={submit}>
          {!state.me.name && (
            <div className="slide-identity">
              <label>
                学校
                <select
                  aria-label="学校"
                  value={draft.school}
                  required
                  disabled={blocked}
                  onChange={(e) => update("school", e.target.value)}
                >
                  <option value="">选择你的学校</option>
                  {state.schools.map((school) => (
                    <option key={school}>{school}</option>
                  ))}
                </select>
              </label>
              <label>
                姓名
                <input
                  aria-label="姓名"
                  placeholder="你的姓名"
                  value={draft.name}
                  maxLength={40}
                  required
                  disabled={blocked}
                  onChange={(e) => update("name", e.target.value)}
                />
              </label>
            </div>
          )}
          {kind === "wordcloud" ? (
            <div className="word-entry">
              <label htmlFor="word-entry">你的关键词</label>
              <textarea
                id="word-entry"
                value={draft.words}
                maxLength={100}
                placeholder="例如：方便、创造力、未来"
                required
                disabled={blocked}
                onChange={(e) => update("words", e.target.value)}
              />
              <p>填写 1–3 个词，用逗号分隔，每个词最多 12 个字。</p>
            </div>
          ) : (
            <fieldset className={`answer-options ${kind}`} disabled={blocked}>
              <legend className="sr-only">选择你的答案</legend>
              {settings.options.map((option) => (
                <label
                  key={option.id}
                  className={draft.answer === option.id ? "selected" : ""}
                >
                  <input
                    type="radio"
                    name="answer"
                    value={option.id}
                    checked={draft.answer === option.id}
                    required
                    onChange={() => update("answer", option.id)}
                  />
                  <span className="answer-letter">
                    {kind === "judge" ? (
                      option.id === "true" ? (
                        <Check size={28} />
                      ) : (
                        <span>×</span>
                      )
                    ) : (
                      option.id
                    )}
                  </span>
                  <span>{option.label}</span>
                  <span className="option-check">
                    {draft.answer === option.id && <Check size={17} />}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <div className="answer-bottom">
            <p className="answer-feedback" role="status">
              {error ||
                wordError ||
                (state.room.paused
                  ? "老师暂停了作答，请稍候。"
                  : "提交后即可查看全班结果，每个活动提交一次。")}
            </p>
            <button
              className="slide-submit"
              type="submit"
              disabled={
                blocked ||
                (kind === "wordcloud"
                  ? !words.length ||
                    words.length > 3 ||
                    words.some((word) => [...word].length > 12)
                  : !draft.answer)
              }
            >
              {busy
                ? "正在提交…"
                : state.room.paused
                  ? "已暂停作答"
                  : "提交我的答案"}
              <ArrowRight size={20} />
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

export function TeacherDisplayDialog({ classroomId, onClose, onEntered }) {
  const dialog = useRef();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);
  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/display/login", { classroomId, pin });
      const session = await api(
        `/api/session?${new URLSearchParams({ role: "presenter", classroomId })}`,
      );
      if (!session.state && !session.ended)
        throw new Error(
          "展示码已验证，但登录会话未建立。请在独立标签页打开课堂链接；若仍失败，请联系管理人员。",
        );
      onEntered();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="teacher-display-dialog"
      aria-labelledby="teacher-display-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit}>
        <div className="teacher-display-dialog-heading">
          <h2 id="teacher-display-title">教师展示</h2>
          <button
            type="button"
            aria-label="关闭教师验证"
            onClick={onClose}
            disabled={busy}
          >
            <X size={21} />
          </button>
        </div>
        <p>输入管理端显示的四位展示码，即可直接查看全班结果。</p>
        <label>
          四位展示码
          <input
            type="password"
            value={pin}
            onChange={(event) =>
              setPin(event.target.value.replace(/\D/g, "").slice(0, 4))
            }
            inputMode="numeric"
            pattern="[0-9]{4}"
            autoComplete="off"
            autoFocus
            required
            maxLength={4}
            disabled={busy}
          />
        </label>
        {error && (
          <p className="slide-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="slide-submit"
          disabled={busy || !/^\d{4}$/.test(pin)}
        >
          {busy ? "正在验证…" : "进入教师展示"}
          <ArrowRight size={19} />
        </button>
      </form>
    </dialog>
  );
}

function DisplayQuestion({ activity, index, total }) {
  const Icon = icons[activity.kind];
  return (
    <section
      className="slide-answer display-question"
      aria-labelledby="slide-question"
    >
      <div className="answer-kind">
        <span>
          <Icon size={20} />
          {activityNames[activity.kind]}
          {activity.kind === "choice" ? " · 单选" : ""}
        </span>
        <span>
          {String(index + 1).padStart(2, "0")} /{" "}
          {String(total).padStart(2, "0")}
        </span>
      </div>
      <h1
        id="slide-question"
        className={activity.question.length > 38 ? "long-question" : ""}
      >
        {activity.question}
      </h1>
      {activity.kind === "wordcloud" ? (
        <div className="display-word-prompt">
          <Cloud size={52} />
          <p>用 1–3 个关键词，分享你的想法。</p>
          <span>同学提交的关键词将汇成右侧词云。</span>
        </div>
      ) : (
        <ul
          className={`display-options ${activity.kind}`}
          aria-label="本题选项"
        >
          {activity.options.map((option) => (
            <li key={option.id}>
              {activity.kind === "choice" && (
                <span className="answer-letter">{option.id}</span>
              )}
              {option.label}
            </li>
          ))}
        </ul>
      )}
      <p className="display-note">
        <Monitor size={18} />
        教师展示 · 无需作答，结果自动更新
      </p>
    </section>
  );
}

export function StudentPresentation({
  state,
  loading,
  error,
  ended,
  connection,
  refresh,
  presenting = false,
  teacherDisplay,
}) {
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement),
    [fullscreenError, setFullscreenError] = useState("");
  useEffect(() => {
    const update = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setFullscreenError("");
    } catch {
      setFullscreenError("可按浏览器的全屏快捷键进入全屏。");
    }
  };
  const room = state?.room;
  const list = state ? classroomActivities(state) : [];
  const index = list.findIndex((item) => item.id === room?.stage);
  const activity = list[index];
  const active = room?.pageOpen && !!activity;
  const kind = active ? activity.kind : null;
  const stopped = ended || room?.stage === "ended";
  return (
    <SlideFrame>
      <header className="slide-header">
        <a className="slide-brand" href={location.pathname}>
          <span>
            <Sparkles size={23} />
          </span>
          AI 共创课堂<small>一起思考 · 看见不同</small>
        </a>
        <div
          className="slide-progress"
          aria-label="课堂活动进度"
          aria-live="polite"
        >
          {active ? (
            <span className="current-progress">
              活动 <strong>{String(index + 1).padStart(2, "0")}</strong>
              <span>/ {String(list.length).padStart(2, "0")}</span>
              <b>{activityNames[kind]}</b>
              {state.submissions?.[activity.id] && <Check size={16} />}
            </span>
          ) : (
            <span>
              {list.length
                ? `本节课共 ${list.length} 个活动`
                : "等待老师安排活动"}
            </span>
          )}
        </div>
        <div className="slide-header-actions">
          {teacherDisplay}
          <button
            className="fullscreen-button"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? "退出全屏" : "进入全屏"}
          >
            {fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
            {fullscreen ? "退出全屏" : "全屏展示"}
          </button>
        </div>
      </header>
      {active ? (
        <div
          className="slide-columns"
          key={`${room.id}:${presenting ? "teacher" : state.me.id}:${activity.id}:${activity.revision}`}
        >
          {presenting ? (
            <DisplayQuestion
              activity={activity}
              index={index}
              total={list.length}
            />
          ) : (
            <AnswerPanel
              state={state}
              activity={activity}
              index={index}
              total={list.length}
              refresh={refresh}
            />
          )}
          {presenting || state.submissions[activity.id] ? (
            <ActivityResults
              state={state}
              kind={kind}
              activityId={activity.id}
              role={presenting ? "presenter" : "student"}
            />
          ) : (
            <LockedResults kind={kind} />
          )}
        </div>
      ) : (
        <section className="slide-curtain" aria-live="polite">
          <span className="curtain-mark">
            {stopped ? (
              <CheckCheck size={48} />
            ) : error ? (
              <CircleHelp size={48} />
            ) : (
              <Monitor size={48} />
            )}
          </span>
          <span className="slide-kicker">THINK · CHOOSE · CREATE</span>
          <h1>
            {loading
              ? "正在连接课堂"
              : stopped
                ? "谢谢参与，下次再见"
                : error
                  ? "暂时无法进入课堂"
                  : presenting && !state
                    ? "请输入四位展示码"
                    : "准备好，一起思考"}
          </h1>
          <p>
            {error ||
              (stopped
                ? "本节课堂已经结束，提交的答案已保存。"
                : presenting && !state
                  ? "展示登录已过期或展示码已更新，请点击上方按钮输入展示码。"
                  : "请留在这里，老师开始活动后，页面会自动切换。")}
          </p>
          {error && (
            <button className="slide-submit" onClick={refresh}>
              重新连接
              <ArrowRight size={20} />
            </button>
          )}
          {!error && !stopped && (
            <div className="curtain-steps">
              {presentationKinds.map((key) => (
                <span key={key}>{activityNames[key]}</span>
              ))}
            </div>
          )}
        </section>
      )}
      <footer className="slide-footer">
        <span>
          {presenting
            ? "教师展示 · 跟随课堂节奏"
            : kind
              ? descriptions[kind]
              : "先独立思考，再一起交流"}
        </span>
        <span
          className={
            error || connection === "offline" ? "connection-failed" : ""
          }
        >
          {error ||
            fullscreenError ||
            (room?.paused && active
              ? "老师已暂停作答"
              : state
                ? "● 页面自动跟随老师"
                : "正在连接课堂…")}
        </span>
        {state?.me?.name && <span>{state.me.name}</span>}
      </footer>
    </SlideFrame>
  );
}

export function ActivityEditor({ state, refresh, controlBusy, onStart }) {
  const list = classroomActivities(state);
  const [editing, setEditing] = useState(null),
    [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const editDialog = useRef(),
    deleteDialog = useRef();
  const selected = list.find((item) => item.id === editing);
  const pending = list.find((item) => item.id === deleting);
  const ended = state.room.stage === "ended";
  const blocked = busy || controlBusy || ended;
  useEffect(() => {
    if (selected) editDialog.current?.showModal();
    else {
      editDialog.current?.close();
      setEditing(null);
    }
  }, [selected?.id]);
  useEffect(() => {
    if (pending) deleteDialog.current?.showModal();
    else {
      deleteDialog.current?.close();
      setDeleting(null);
    }
  }, [pending?.id]);
  const change = async (body) => {
    setBusy(true);
    setMessage("");
    try {
      const result = await api("/api/teacher/activities", {
        roomId: state.room.id,
        revision: state.room.revision,
        ...body,
      });
      await refresh();
      if (result.createdActivityId) setEditing(result.createdActivityId);
      if (body.action === "delete") {
        setDeleting(null);
        setMessage("活动及其提交已删除。");
      }
    } catch (error) {
      setMessage(error.message);
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const move = (index, offset) => {
    const order = list.map((item) => item.id);
    [order[index], order[index + offset]] = [
      order[index + offset],
      order[index],
    ];
    change({ action: "reorder", order });
  };
  return (
    <div className="activity-manager">
      <div className="editor-heading">
        <div>
          <h2>
            本节课的活动{" "}
            <small>
              {list.length} / {maxActivities}
            </small>
          </h2>
          <p>
            按教学顺序安排活动，同一种类型可以多次添加。开始活动后，全班自动跟随。
          </p>
        </div>
        <div className="activity-add" aria-label="添加课堂活动">
          {presentationKinds.map((kind) => (
            <button
              key={kind}
              className="secondary"
              disabled={blocked || list.length >= maxActivities}
              onClick={() => change({ action: "add", kind })}
            >
              <Plus size={16} />
              添加{activityNames[kind]}
            </button>
          ))}
        </div>
      </div>
      <ol className="activity-list" aria-label="本节课的活动列表">
        {list.map((item, index) => {
          const current = state.room.stage === item.id,
            Icon = icons[item.kind];
          return (
            <li
              key={item.id}
              className={current ? "current" : ""}
              aria-label={`活动 ${index + 1}：${item.question}`}
            >
              <span className="activity-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="activity-summary">
                <div>
                  <span className="activity-type">
                    <Icon size={15} />
                    {activityNames[item.kind]}
                  </span>
                  <span>{state.counts[item.id] || 0} 份提交</span>
                  {current && <b>当前活动</b>}
                </div>
                <strong>{item.question}</strong>
              </div>
              <div className="activity-row-actions">
                <button
                  className={current ? "secondary" : "primary"}
                  disabled={blocked || current}
                  aria-label={`开始活动 ${index + 1}`}
                  onClick={() => onStart(item.id)}
                >
                  <Play size={15} />
                  {current ? "正在进行" : "开始活动"}
                </button>
                <button
                  className="secondary"
                  disabled={busy || controlBusy}
                  aria-label={`编辑活动 ${index + 1}`}
                  onClick={() => {
                    setMessage("");
                    setEditing(item.id);
                  }}
                >
                  <Pencil size={15} />
                  编辑
                </button>
                <button
                  className="activity-icon-button"
                  title="上移"
                  aria-label={`上移活动 ${index + 1}`}
                  disabled={blocked || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={18} />
                </button>
                <button
                  className="activity-icon-button"
                  title="下移"
                  aria-label={`下移活动 ${index + 1}`}
                  disabled={blocked || index === list.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={18} />
                </button>
                <button
                  className="activity-icon-button delete-action"
                  title="删除活动"
                  aria-label={`删除活动 ${index + 1}`}
                  disabled={blocked}
                  onClick={() => {
                    setMessage("");
                    setDeleting(item.id);
                  }}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      {!list.length && (
        <p className="activities-empty">
          还没有活动，从上方添加一个判断题、选择题或词云开始。学生会留在等候页。
        </p>
      )}
      <p className="editor-message" role="status">
        {message ||
          (ended
            ? "本节课已结束。开始新课堂后，可继续调整活动。"
            : "已有提交的活动可移动或删除；题干和选项会锁定，避免统计混淆。")}
      </p>
      <dialog
        ref={editDialog}
        className="activity-edit-dialog activity-editor"
        aria-labelledby="edit-activity-title"
        onCancel={() => setEditing(null)}
        onClose={() => setEditing(null)}
      >
        {selected && (
          <>
            <div className="editor-heading">
              <h2 id="edit-activity-title">
                编辑{activityNames[selected.kind]}
              </h2>
              <button
                className="activity-icon-button"
                aria-label="关闭活动编辑"
                onClick={() => setEditing(null)}
              >
                <X size={20} />
              </button>
            </div>
            <EditorForm
              key={`${state.room.id}:${selected.id}:${selected.revision}`}
              state={state}
              activity={selected}
              refresh={refresh}
              onSaved={() => {
                setEditing(null);
                setMessage("活动内容已保存。");
              }}
            />
          </>
        )}
      </dialog>
      <dialog
        ref={deleteDialog}
        className="delete-dialog"
        aria-labelledby="delete-activity-title"
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setDeleting(null);
        }}
        onClose={() => setDeleting(null)}
      >
        {pending && (
          <>
            <h2 id="delete-activity-title">删除这个活动？</h2>
            <p className="delete-activity-question">{pending.question}</p>
            <p>
              该活动及其全部提交将永久删除，不再出现在学生页面、统计和导出中。此操作不可撤销。
            </p>
            {state.room.stage === pending.id && (
              <p>这是当前活动。删除后，全班回到等候页，等待你开始其他活动。</p>
            )}
            {message && <p role="alert">{message}</p>}
            <div className="dialog-actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setDeleting(null)}
              >
                取消
              </button>
              <button
                className="primary danger-button"
                disabled={busy}
                onClick={() =>
                  change({ action: "delete", id: pending.id, confirm: true })
                }
              >
                {busy ? "正在删除…" : "确认删除活动及提交"}
              </button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}

function EditorForm({ state, activity, refresh, onSaved }) {
  const { id, kind } = activity,
    settings = activity;
  const [question, setQuestion] = useState(settings.question),
    [options, setOptions] = useState(
      settings.options.map((option) => option.label),
    );
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const locked = !!state.activityLocks[id] || state.room.stage === "ended";
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await api(`/api/teacher/activities/${id}`, {
        roomId: state.room.id,
        revision: state.room.revision,
        question,
        options,
      });
      await refresh();
      onSaved();
    } catch (error) {
      setMessage(error.message);
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save}>
      <fieldset disabled={busy || locked}>
        <label>
          题干 <small>{question.length} / 60 字</small>
          <textarea
            aria-label={`${activityNames[kind]}题干`}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            required
            maxLength={60}
            rows={2}
          />
        </label>
        {kind === "choice" && (
          <>
            <div className="editor-options">
              {options.map((option, index) => (
                <label key={index}>
                  {String.fromCharCode(65 + index)}
                  <input
                    aria-label={`选项 ${String.fromCharCode(65 + index)}`}
                    value={option}
                    maxLength={24}
                    required
                    onChange={(e) =>
                      setOptions((values) =>
                        values.map((value, i) =>
                          i === index ? e.target.value : value,
                        ),
                      )
                    }
                  />
                </label>
              ))}
            </div>
            <div className="editor-option-actions">
              <button
                type="button"
                className="secondary"
                disabled={options.length >= 6 || locked || busy}
                onClick={() => setOptions((values) => [...values, ""])}
              >
                添加选项
              </button>
              <button
                type="button"
                className="text-button"
                disabled={options.length <= 2 || locked || busy}
                onClick={() => setOptions((values) => values.slice(0, -1))}
              >
                移除末尾选项
              </button>
              <span>支持 2–6 个选项，每项最多 24 字</span>
            </div>
          </>
        )}
        {kind === "judge" && (
          <p>固定选项：正确、错误。展示选择比例，不自动判分。</p>
        )}
        {kind === "wordcloud" && (
          <p>
            每人提交 1–3
            个词；同一人的重复词只计一次。所有活动均在提交后展示全班结果。
          </p>
        )}
        <button className="primary" disabled={busy || locked}>
          {busy ? "正在保存…" : "保存活动内容"}
        </button>
      </fieldset>
      <p className="editor-message" role="status">
        {message ||
          (locked
            ? "此题已锁定。需要换题时，可以另添一个同类型活动。"
            : `当前题目版本 ${settings.revision} · 保存后自动同步到学生端`)}
      </p>
    </form>
  );
}

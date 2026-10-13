import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
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
      key={`${props.state.room.id}:${props.kind}:${props.role}`}
      {...props}
    />
  );
}

function ResultsPanel({ state, kind, role = "student" }) {
  const [data, setData] = useState(null),
    [error, setError] = useState("");
  const refresh = useRef();
  useEffect(() => {
    let active = true;
    setData(null);
    const queue = createRefreshQueue(async () => {
      try {
        const result = await api(
          `/api/results?${new URLSearchParams({ kind, role, classroomId: state.room.id })}`,
        );
        if (active) {
          setData(result);
          setError("");
        }
      } catch (e) {
        if (active) setError(e.message);
      }
    });
    refresh.current = () => queue.update();
    queue.update();
    return () => {
      active = false;
      queue.stop();
    };
  }, [kind, role, state.room.id]);
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

function AnswerPanel({ state, kind, refresh }) {
  const settings = state.activitySettings[kind],
    submitted = state.submissions[kind];
  const draftKey = `slide-draft:${state.room.id}:${state.me.id}:${kind}:${settings.revision}`;
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
      await api(`/api/student/submit/${kind}?classroomId=${state.room.id}`, {
        ...(!state.me.name ? { name: draft.name, school: draft.school } : {}),
        activityRevision: settings.revision,
        ...(kind === "wordcloud"
          ? { words: draft.words }
          : { answer: draft.answer }),
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
    <section className="slide-answer" aria-labelledby="slide-question">
      <div className="answer-kind">
        <span>
          <Icon size={20} /> {activityNames[kind]}
          {kind === "choice" ? " · 单选" : ""}
        </span>
        <span>
          {String(presentationKinds.indexOf(kind) + 1).padStart(2, "0")} / 03
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

export function StudentPresentation({
  state,
  loading,
  error,
  ended,
  connection,
  refresh,
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
  const active = room?.pageOpen && presentationKinds.includes(room.stage);
  const kind = active ? room.stage : null;
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
        <ol className="slide-progress" aria-label="课堂活动进度">
          {presentationKinds.map((key, index) => (
            <li
              key={key}
              className={kind === key ? "active" : ""}
              aria-current={kind === key ? "step" : undefined}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              {activityNames[key]}
              {state?.submissions[key] && <Check size={14} />}
            </li>
          ))}
        </ol>
        <button
          className="fullscreen-button"
          onClick={toggleFullscreen}
          aria-label={fullscreen ? "退出全屏" : "进入全屏"}
        >
          {fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
          {fullscreen ? "退出全屏" : "全屏展示"}
        </button>
      </header>
      {active ? (
        <div
          className="slide-columns"
          key={`${room.id}:${state.me.id}:${kind}:${state.activitySettings[kind].revision}`}
        >
          <AnswerPanel state={state} kind={kind} refresh={refresh} />
          {state.submissions[kind] ? (
            <ActivityResults state={state} kind={kind} />
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
                  : "准备好，一起思考"}
          </h1>
          <p>
            {error ||
              (stopped
                ? "本节课堂已经结束，提交的答案已保存。"
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
        <span>{kind ? descriptions[kind] : "先独立思考，再一起交流"}</span>
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
        {state?.me.name && <span>{state.me.name}</span>}
      </footer>
    </SlideFrame>
  );
}

export function ActivityEditor({ state, refresh }) {
  const [kind, setKind] = useState("judge");
  return (
    <section className="activity-editor">
      <div className="editor-heading">
        <div>
          <h2>活动内容</h2>
          <p>
            修改题干和选项后保存。收到第一份提交后，本题锁定，保证全班统计一致。
          </p>
        </div>
        <div className="tabs">
          {presentationKinds.map((key) => (
            <button
              key={key}
              className={key === kind ? "active" : ""}
              onClick={() => setKind(key)}
            >
              {activityNames[key]}
            </button>
          ))}
        </div>
      </div>
      <EditorForm
        key={`${state.room.id}:${kind}:${state.activitySettings[kind].revision}`}
        kind={kind}
        state={state}
        refresh={refresh}
      />
    </section>
  );
}

function EditorForm({ state, kind, refresh }) {
  const settings = state.activitySettings[kind];
  const [question, setQuestion] = useState(settings.question),
    [options, setOptions] = useState(
      settings.options.map((option) => option.label),
    );
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const locked = !!state.activityLocks[kind] || state.room.stage === "ended";
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await api(`/api/teacher/activities/${kind}`, {
        roomId: state.room.id,
        revision: state.room.revision,
        question,
        options,
      });
      await refresh();
    } catch (error) {
      setMessage(error.message);
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
            ? "此题已锁定。需要更换题目时，请先导出记录，再开始新课堂。"
            : `当前题目版本 ${settings.revision} · 保存后自动同步到学生端`)}
      </p>
    </form>
  );
}

import type { KeyboardEvent, ReactElement, ReactNode } from 'react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApiFetch, ApiError } from '../auth/useApiFetch';
import { sendCopilotMessage } from '../api/copilot';
import type { CopilotMessage, CopilotToolUse } from '../api/types';

// A few canned questions to seed the conversation when the chat is empty.
const STARTER_PROMPTS = [
  'What did eggs cost me last month?',
  'Which animals are overdue?',
  'Am I in the black this month?',
];

// Assistant turns may carry the tools the copilot consulted; we render them
// as small chips, so each rendered turn pairs a message with optional tools.
interface Turn {
  message: CopilotMessage;
  toolsUsed?: CopilotToolUse[];
}

export default function Copilot(): ReactElement {
  const apiFetch = useApiFetch();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the latest turn (and the loading/error rows) in view as they arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, busy, error]);

  const send = useCallback(
    async (text: string): Promise<void> => {
      const content = text.trim();
      if (content.length === 0 || busy) return;

      setError(null);
      const userTurn: Turn = { message: { role: 'user', content } };
      const nextTurns = [...turns, userTurn];
      setTurns(nextTurns);
      setDraft('');
      setBusy(true);

      // Replay the full history (the server holds no conversation state).
      const history: CopilotMessage[] = nextTurns.map((t) => t.message);
      try {
        const res = await sendCopilotMessage(apiFetch, history);
        setTurns((prev) => [
          ...prev,
          {
            message: { role: 'assistant', content: res.reply },
            toolsUsed: res.toolsUsed,
          },
        ]);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : (err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [apiFetch, busy, turns],
  );

  // Retry resends the trailing user turn (dropping a prior failed attempt's
  // state by simply replaying history again).
  const retry = useCallback((): void => {
    const lastUser = [...turns].reverse().find((t) => t.message.role === 'user');
    if (!lastUser || busy) return;
    setError(null);
    setBusy(true);
    const history: CopilotMessage[] = turns.map((t) => t.message);
    void sendCopilotMessage(apiFetch, history)
      .then((res) => {
        setTurns((prev) => [
          ...prev,
          {
            message: { role: 'assistant', content: res.reply },
            toolsUsed: res.toolsUsed,
          },
        ]);
      })
      .catch((err: Error) => {
        setError(err instanceof ApiError ? err.message : err.message);
      })
      .finally(() => setBusy(false));
  }, [apiFetch, busy, turns]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(draft);
    }
  };

  const isEmpty = turns.length === 0;

  return (
    <section className="space-y-6 flex flex-col h-[calc(100vh-9rem)]">
      <header className="space-y-1 shrink-0">
        <h1 className="text-2xl font-semibold text-foreground">Copilot</h1>
        <p className="text-muted-foreground">
          Ask questions across your homestead data. The copilot is read-only — it
          can look things up but won&apos;t change anything.
        </p>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1"
        aria-live="polite"
      >
        {isEmpty ? (
          <EmptyState onPick={(p) => void send(p)} disabled={busy} />
        ) : (
          turns.map((turn, i) => <MessageBubble key={i} turn={turn} />)
        )}

        {busy && <LoadingBubble />}

        {error && (
          <div className="max-w-[85%] mr-auto space-y-2">
            <p className="form-error">{error}</p>
            <button type="button" className="btn-secondary" onClick={retry} disabled={busy}>
              Retry
            </button>
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-2">
        <div className="flex items-end gap-2">
          <textarea
            className="input resize-none flex-1"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about eggs, feed, animals, P&L…"
            disabled={busy}
            aria-label="Message the copilot"
          />
          <button
            type="button"
            className="btn-primary shrink-0"
            onClick={() => void send(draft)}
            disabled={busy || draft.trim().length === 0}
          >
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
        <p className="field-hint text-xs text-muted-foreground">
          Enter to send, Shift+Enter for a new line.
        </p>
      </div>
    </section>
  );
}

function EmptyState({
  onPick,
  disabled,
}: {
  onPick: (prompt: string) => void;
  disabled: boolean;
}): ReactElement {
  return (
    <div className="card card-body space-y-4 max-w-2xl">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">
          What would you like to know?
        </h2>
        <p className="text-sm text-muted-foreground">
          Try one of these, or type your own question below.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {STARTER_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="btn-secondary text-sm"
            onClick={() => onPick(prompt)}
            disabled={disabled}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ turn }: { turn: Turn }): ReactElement {
  const isUser = turn.message.role === 'user';
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={
          isUser
            ? 'max-w-[85%] rounded-lg bg-primary-100 text-primary-700 px-3 py-2'
            : 'max-w-[85%] rounded-lg bg-muted text-foreground px-3 py-2'
        }
      >
        {isUser ? (
          <p className="whitespace-pre-wrap text-sm">{turn.message.content}</p>
        ) : (
          <Markdown text={turn.message.content} />
        )}
        {!isUser && turn.toolsUsed && turn.toolsUsed.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">consulted:</span>
            {turn.toolsUsed.map((tool, i) => (
              <span
                key={`${tool.name}-${i}`}
                className="inline-flex items-center rounded-full bg-surface border border-border px-2 py-0.5 text-xs text-muted-foreground"
              >
                {tool.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LoadingBubble(): ReactElement {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2">
        <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
          Thinking
          <span className="inline-flex gap-0.5">
            <Dot delay="0ms" />
            <Dot delay="150ms" />
            <Dot delay="300ms" />
          </span>
        </span>
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: string }): ReactElement {
  return (
    <span
      className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce"
      style={{ animationDelay: delay }}
    />
  );
}

// --- Minimal, safe markdown renderer ------------------------------------
//
// No markdown dependency ships with the dashboard, and the copilot only emits
// lightweight formatting, so we render a deliberately small subset — bold,
// inline code, unordered/ordered lists, and line breaks — by building React
// nodes directly. Nothing is injected as HTML, so this is XSS-safe by
// construction.
function Markdown({ text }: { text: string }): ReactElement {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return <div className="text-sm space-y-2">{blocks}</div>;
}

function parseBlocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushPara = (): void => {
    if (para.length === 0) return;
    blocks.push(
      <p key={key++} className="whitespace-pre-wrap">
        {renderInline(para.join('\n'))}
      </p>,
    );
    para = [];
  };

  const flushList = (): void => {
    if (!list) return;
    const items = list.items.map((item, i) => (
      <li key={i}>{renderInline(item)}</li>
    ));
    blocks.push(
      list.ordered ? (
        <ol key={key++} className="list-decimal pl-5 space-y-1">
          {items}
        </ol>
      ) : (
        <ul key={key++} className="list-disc pl-5 space-y-1">
          {items}
        </ul>
      ),
    );
    list = null;
  };

  for (const line of lines) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
    } else if (numbered) {
      flushPara();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1]);
    } else if (line.trim() === '') {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

// Renders inline **bold** and `code` spans within a single text run.
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Split on bold (**...**) and inline code (`...`), keeping the delimiters.
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  tokens.forEach((token, i) => {
    if (!token) return;
    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong key={i} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code key={i} className="rounded bg-surface px-1 py-0.5 text-[0.85em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(<Fragment key={i}>{token}</Fragment>);
    }
  });
  return nodes;
}

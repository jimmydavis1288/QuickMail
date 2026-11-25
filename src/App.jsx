import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  Check,
  CheckCheck,
  Clock3,
  Copy,
  Inbox,
  LoaderCircle,
  Mail,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

const API_URL = import.meta.env.VITE_SUPABASE_URL;
const API_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const STORAGE_KEY = "quickmail.active-inbox";

function readSavedInbox() {
  let saved;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { inbox: null, error: "" };
    saved = JSON.parse(raw);
    if (
      saved &&
      typeof saved.id === "string" &&
      typeof saved.token === "string" &&
      typeof saved.email === "string" &&
      typeof saved.expiresAt === "string"
    ) {
      return { inbox: saved, error: "" };
    }
    return { inbox: null, error: "Saved inbox details are invalid. Create a new inbox to continue." };
  } catch (storageError) {
    console.error("Could not restore the saved inbox:", storageError);
    return { inbox: null, error: "Saved inbox details could not be read. Create a new inbox to continue." };
  }
}

async function callFunction(name, body) {
  if (!API_URL || !API_KEY) {
    throw new Error(
      "Connect your Supabase project by setting VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
    );
  }

  let response;
  try {
    response = await fetch(`${API_URL.replace(/\/$/, "")}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: API_KEY,
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Could not reach QuickMail. Check your connection and try again.");
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("QuickMail returned an invalid response. Please try again.");
  }
  if (!response.ok) {
    throw new Error(data.error || "QuickMail could not complete that request.");
  }
  return data;
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function timeAgo(value) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return new Date(value).toLocaleDateString();
}

function App() {
  const [savedInbox] = useState(readSavedInbox);
  const [inbox, setInbox] = useState(savedInbox.inbox);
  const [messages, setMessages] = useState([]);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(savedInbox.error);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [copied, setCopied] = useState(false);
  const refreshTimer = useRef(null);

  const expired = Boolean(inbox && secondsLeft <= 0);

  const refreshInbox = useCallback(
    async (quiet = false) => {
      if (!inbox || Date.now() >= new Date(inbox.expiresAt).getTime()) {
        if (inbox) setSecondsLeft(0);
        return;
      }
      if (quiet) setRefreshing(true);
      else setLoading(true);
      setError("");
      try {
        const result = await callFunction("inbox-api", {
          inbox_id: inbox.id,
          access_token: inbox.token,
        });
        setMessages(result.messages || []);
      } catch (requestError) {
        setError(requestError.message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [inbox],
  );

  useEffect(() => {
    if (!inbox) return undefined;
    const tick = () => {
      const remaining = Math.max(
        0,
        Math.ceil((new Date(inbox.expiresAt).getTime() - Date.now()) / 1000),
      );
      setSecondsLeft(remaining);
      if (remaining === 0) {
        setMessages([]);
        setSelectedMessage(null);
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [inbox]);

  useEffect(() => {
    if (!inbox || expired) return undefined;
    refreshInbox();
    refreshTimer.current = window.setInterval(() => refreshInbox(true), 15000);
    return () => window.clearInterval(refreshTimer.current);
  }, [inbox, expired, refreshInbox]);

  const createInbox = async () => {
    setLoading(true);
    setError("");
    setSelectedMessage(null);
    try {
      const result = await callFunction("create-inbox", {});
      const nextInbox = {
        id: result.inbox_id,
        token: result.access_token,
        email: result.email_address,
        expiresAt: result.expires_at,
      };
      setInbox(nextInbox);
      setMessages([]);
      setSecondsLeft(600);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextInbox));
      } catch (storageError) {
        console.error("Could not save the created inbox:", storageError);
        setError("Inbox created, but this browser could not save it. Keep this tab open until it expires.");
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const copyAddress = async () => {
    if (!inbox) return;
    try {
      await navigator.clipboard.writeText(inbox.email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Clipboard access is unavailable. Select and copy the address instead.");
    }
  };

  const openMessage = async (message) => {
    if (!inbox || expired) return;
    setSelectedMessage({ ...message, loading: true });
    try {
      const result = await callFunction("inbox-api", {
        inbox_id: inbox.id,
        access_token: inbox.token,
        message_id: message.id,
      });
      setSelectedMessage(result.message);
    } catch (requestError) {
      setSelectedMessage(null);
      setError(requestError.message);
    }
  };

  const dismissError = () => {
    setError("");
  };

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8 sm:py-7">
        <a href="/" className="flex items-center gap-2.5" aria-label="QuickMail home">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-green-500 text-white">
            <Mail size={18} strokeWidth={2.2} />
          </span>
          <span className="text-[17px] font-semibold tracking-[-0.04em]">quickmail</span>
        </a>
        <div className="flex items-center gap-2 rounded-full border border-[#e7eae6] bg-white px-3 py-1.5 text-xs font-medium text-muted">
          <ShieldCheck size={14} className="text-green-500" />
          Private by design
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-5 pb-16 pt-9 sm:px-8 sm:pt-14">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-green-100 bg-green-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-green-600">
            <Sparkles size={13} />
            A little more privacy
          </div>
          <h1 className="text-[38px] font-semibold leading-[1.08] tracking-[-0.055em] sm:text-[56px]">
            Your inbox, <span className="text-green-500">on your terms.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-7 text-muted sm:text-base">
            A fresh, private email address for the things you&apos;d rather keep separate.
            No sign-up, no strings attached.
          </p>
        </div>

        <section className="mx-auto mt-10 max-w-3xl overflow-hidden rounded-2xl border border-[#e9ece8] bg-white shadow-card sm:mt-12">
          <div className="flex flex-col gap-5 p-5 sm:p-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-50 text-green-500">
                  <Inbox size={16} />
                </span>
                Your temporary inbox
              </div>
              <div
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  expired
                    ? "bg-red-50 text-red-600"
                    : inbox
                      ? "bg-amber-50 text-amber-700"
                      : "bg-[#f4f5f3] text-muted"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    expired ? "bg-red-500" : inbox ? "bg-amber-500" : "bg-[#a8ada9]"
                  }`}
                />
                {expired ? "Expired" : inbox ? "Not connected" : "Not active"}
              </div>
            </div>

            {inbox && !expired ? (
              <div className="flex flex-col gap-4 rounded-xl border border-[#edf0ec] bg-[#fafbf9] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="min-w-0">
                  <p className="mb-1.5 text-xs font-medium text-muted">Your email address</p>
                  <p className="break-all text-[17px] font-semibold tracking-[-0.035em] sm:text-xl">
                    {inbox.email}
                  </p>
                </div>
                <button
                  onClick={copyAddress}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-[#e3e8e2] bg-white px-3.5 py-2.5 text-sm font-semibold transition hover:border-green-200 hover:bg-green-50"
                  aria-label="Copy email address"
                >
                  {copied ? <Check size={16} className="text-green-600" /> : <Copy size={15} />}
                  {copied ? "Copied" : "Copy address"}
                </button>
              </div>
            ) : (
              <div className="flex min-h-[106px] flex-col items-center justify-center rounded-xl border border-dashed border-[#dfe5df] bg-[#fafbf9] px-5 text-center">
                <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-white text-muted shadow-sm">
                  {expired ? <Clock3 size={17} /> : <Mail size={17} />}
                </span>
                <p className="text-sm font-semibold">
                  {expired ? "This inbox has expired" : "A verified domain is needed to create an inbox"}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {expired ? "Create a new inbox to continue." : "Create a private inbox in seconds."}
                </p>
              </div>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {inbox && !expired ? (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <Clock3 size={15} className={secondsLeft < 60 ? "text-red-500" : "text-green-500"} />
                  <span>Expires in</span>
                  <span
                    className={`font-mono text-sm font-semibold tabular-nums ${
                      secondsLeft < 60 ? "text-red-600" : "text-ink"
                    }`}
                    aria-live="polite"
                  >
                    {formatTime(secondsLeft)}
                  </span>
                </div>
              ) : (
                <span className="text-xs text-muted">Each address lasts for 10 minutes.</span>
              )}
              <div className="flex gap-2">
                {inbox && !expired && (
                  <button
                    onClick={() => refreshInbox()}
                    disabled={loading || refreshing}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#e5e9e4] px-3.5 py-2.5 text-sm font-semibold transition hover:bg-[#f8faf7] disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
                  >
                    <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
                    Refresh
                  </button>
                )}
                <button
                  onClick={createInbox}
                  disabled={loading}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-70 sm:flex-none"
                >
                  {loading ? (
                    <LoaderCircle size={16} className="animate-spin" />
                  ) : inbox ? (
                    <Plus size={16} />
                  ) : (
                    <Sparkles size={15} />
                  )}
                  {loading ? "Working…" : inbox ? "New address" : "Create inbox"}
                </button>
              </div>
            </div>

            <div className="flex gap-2.5 rounded-lg border border-amber-100 bg-amber-50/70 px-3.5 py-3 text-left">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-amber-700" />
              <p className="text-xs leading-5 text-[#6e5a31]">
                <span className="font-semibold">Live email reception isn&apos;t connected yet.</span>{" "}
                Creating addresses requires a verified domain; receiving messages additionally
                requires an inbound email provider.
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="flex items-start justify-between gap-3 rounded-lg border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-red-700"
              >
                <span>{error}</span>
                <button onClick={dismissError} aria-label="Dismiss message">
                  <X size={15} />
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="mx-auto mt-7 max-w-3xl overflow-hidden rounded-2xl border border-[#e9ece8] bg-white shadow-card">
          <div className="flex items-center justify-between border-b border-[#eff1ee] px-5 py-4 sm:px-7">
            <div>
              <h2 className="text-sm font-semibold">Inbox</h2>
              <p className="mt-0.5 text-xs text-muted">
                {messages.length > 0
                  ? `${messages.length} ${messages.length === 1 ? "message" : "messages"}`
                  : "Messages appear here"}
              </p>
            </div>
            {messages.length > 0 && (
              <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-600">
                {messages.length} new
              </span>
            )}
          </div>

          {selectedMessage ? (
            <article className="min-h-[205px] p-5 sm:p-7">
              <button
                onClick={() => setSelectedMessage(null)}
                className="mb-5 inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink"
              >
                <ArrowLeft size={14} /> Back to inbox
              </button>
              {selectedMessage.loading ? (
                <div className="flex items-center gap-2 py-5 text-sm text-muted">
                  <LoaderCircle size={16} className="animate-spin" /> Loading message…
                </div>
              ) : (
                <>
                  <h3 className="text-lg font-semibold tracking-tight">{selectedMessage.subject}</h3>
                  <p className="mt-2 text-xs text-muted">
                    From <span className="font-medium text-ink">{selectedMessage.sender}</span>
                    {" · "}
                    {new Date(selectedMessage.received_at).toLocaleString()}
                  </p>
                  <div className="mt-5 whitespace-pre-wrap border-t border-[#eff1ee] pt-5 text-sm leading-7 text-[#424a44]">
                    {selectedMessage.text_body}
                  </div>
                </>
              )}
            </article>
          ) : messages.length > 0 && !expired ? (
            <div className="divide-y divide-[#eff1ee]">
              {messages.map((message) => (
                <button
                  key={message.id}
                  onClick={() => openMessage(message)}
                  className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-[#fafbf9] sm:px-7"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-50 text-green-600">
                    <Mail size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-col justify-between gap-1 sm:flex-row sm:items-center">
                      <span className="truncate text-sm font-semibold">{message.sender}</span>
                      <span className="shrink-0 text-[11px] text-muted">
                        {timeAgo(message.received_at)}
                      </span>
                    </span>
                    <span className="mt-1 block truncate text-sm text-[#49514b]">
                      {message.subject}
                    </span>
                  </span>
                  <ArrowDown size={14} className="-rotate-90 shrink-0 text-[#9ba29c]" />
                </button>
              ))}
            </div>
          ) : (
            <div className="flex min-h-[206px] flex-col items-center justify-center px-6 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f4f6f3] text-[#89918b]">
                {loading ? (
                  <LoaderCircle size={19} className="animate-spin" />
                ) : (
                  <Inbox size={19} strokeWidth={1.7} />
                )}
              </span>
              <p className="mt-3 text-sm font-semibold">
                {expired ? "This inbox has expired" : loading ? "Checking your inbox…" : "Nothing here yet"}
              </p>
              <p className="mt-1 max-w-xs text-xs leading-5 text-muted">
                {inbox && !expired
                  ? "We’ll check for new messages automatically."
                  : "Configure a verified email domain to create a temporary inbox."}
              </p>
              {inbox && !expired && (
                <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#f4f6f3] px-2.5 py-1 text-[11px] font-medium text-muted">
                  <CheckCheck size={13} />
                  Auto-refresh is on
                </div>
              )}
            </div>
          )}
        </section>

        <div className="mx-auto mt-6 flex max-w-3xl items-center justify-center gap-2 text-[11px] text-muted">
          <Clock3 size={13} />
          <span>Inbox data is automatically removed when it expires.</span>
        </div>

        <footer className="mx-auto mt-14 flex max-w-3xl flex-col items-center justify-between gap-2 border-t border-[#e8ebe7] pt-5 text-[11px] text-muted sm:flex-row">
          <span>© {new Date().getFullYear()} QuickMail</span>
          <span>Temporary by nature. Private by design.</span>
        </footer>
      </main>
    </div>
  );
}

export default App;

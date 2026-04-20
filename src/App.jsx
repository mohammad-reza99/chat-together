import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, supabaseConfigError } from "./lib/supabase";

const DEFAULT_STATUS = "Connected to the room.";
const LOADING_STATUS = "Loading messages...";
const MAX_MESSAGE_LENGTH = 500;
const EMOJI_OPTIONS = [
  "😄",
  "🔥",
  "😂",
  "❤️",
  "👏",
  "🎯",
  "🚀",
  "😎",
  "👀",
  "✨",
  "🙌",
  "🤝",
  "💡",
  "🎉",
  "🙏",
  "💬",
];

function mergeMessages(currentMessages, incomingMessages) {
  const messageMap = new Map(
    currentMessages.map((message) => [message.id, message]),
  );

  incomingMessages.forEach((message) => {
    messageMap.set(message.id, message);
  });

  return Array.from(messageMap.values()).sort(
    (left, right) =>
      new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
  );
}

function getInitials(email) {
  if (!email) {
    return "?";
  }

  return email.slice(0, 2).toUpperCase();
}

function getDisplayName(userLike) {
  return (
    userLike?.user_metadata?.full_name ||
    userLike?.user_metadata?.name ||
    userLike?.name ||
    userLike?.email ||
    "Unknown user"
  );
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDay(isoString) {
  return new Date(isoString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function getPresenceSnapshot(presenceState, currentUserId) {
  const participants = [];
  const typingUsers = [];

  Object.values(presenceState).forEach((entries) => {
    entries.forEach((entry) => {
      participants.push(entry);

      if (entry.id !== currentUserId && entry.typing) {
        typingUsers.push(entry.name || entry.email || "Someone");
      }
    });
  });

  const dedupedTypingUsers = Array.from(new Set(typingUsers));
  const dedupedParticipants = Array.from(
    new Map(participants.map((entry) => [entry.id, entry])).values(),
  );

  return {
    participants: dedupedParticipants,
    typingUsers: dedupedTypingUsers,
  };
}

function getMessageStatus(message, onlineUsers, currentUserId) {
  if (message.user_id !== currentUserId) {
    return "";
  }

  if (message.seen_at) {
    return "Seen";
  }

  const otherOnlineUsers = onlineUsers.filter((user) => user.id !== currentUserId);
  return otherOnlineUsers.length > 0 ? "Delivered" : "Sent";
}

function Avatar({ src, alt, fallback, size = "md" }) {
  const sizeClass =
    size === "lg" ? "h-14 w-14 rounded-2xl" : "h-10 w-10 rounded-xl";

  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        className={`${sizeClass} shrink-0 border border-white/10 object-cover`}
      />
    );
  }

  return (
    <div
      className={`${sizeClass} inline-flex shrink-0 items-center justify-center border border-amber-200/20 bg-amber-300/10 text-xs font-bold tracking-[0.2em] text-amber-100`}
    >
      {fallback}
    </div>
  );
}

function AuthShell({ badge, title, description, children, statusMessage }) {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.18),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.18),transparent_30%),linear-gradient(135deg,#050816_0%,#0f172a_48%,#111827_100%)] px-4 py-4 text-slate-50 sm:px-6 lg:px-8">
      <section className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-7xl overflow-hidden rounded-[2rem] border border-white/10 bg-white/5 shadow-2xl shadow-black/30 backdrop-blur-xl lg:grid-cols-[1.15fr_0.85fr]">
        <div className="flex flex-col justify-center bg-[linear-gradient(135deg,rgba(251,191,36,0.10),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.06),transparent)] px-6 py-12 sm:px-10 lg:px-14">
          <span className="mb-4 text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">
            Premium Realtime Chat
          </span>
          <h1 className="max-w-xl font-['Cormorant_Garamond'] text-6xl leading-none text-white sm:text-7xl lg:text-8xl">
            Together
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
            A sharper team room with realtime messaging, presence awareness,
            delivery state, and a cleaner interface built on Tailwind.
          </p>
        </div>

        <div className="flex flex-col justify-center border-t border-white/10 bg-slate-950/55 px-6 py-12 sm:px-10 lg:border-l lg:border-t-0 lg:px-12">
          <span className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">
            {badge}
          </span>
          <h2 className="text-3xl font-semibold tracking-tight text-white">
            {title}
          </h2>
          <p className="mt-4 max-w-md text-base leading-7 text-slate-300">
            {description}
          </p>
          <div className="mt-8">{children}</div>
          <p className="mt-5 text-sm text-slate-400">{statusMessage}</p>
        </div>
      </section>
    </main>
  );
}

function App() {
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [usersOnline, setUsersOnline] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [statusMessage, setStatusMessage] = useState(
    supabaseConfigError || "Checking your session...",
  );
  const [hasResolvedSession, setHasResolvedSession] = useState(
    Boolean(supabaseConfigError),
  );
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [messagesError, setMessagesError] = useState("");

  const chatContainerRef = useRef(null);
  const roomChannelRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const seenQueueRef = useRef(false);

  const currentUser = session?.user ?? null;
  const currentUserId = currentUser?.id ?? null;
  const userName = getDisplayName(currentUser);

  const latestMessage = useMemo(
    () => (messages.length === 0 ? null : messages[messages.length - 1]),
    [messages],
  );

  const onlineUsers = useMemo(() => {
    if (!currentUser) {
      return [];
    }

    const baseUsers = usersOnline.length
      ? usersOnline
      : [
          {
            id: currentUser.id,
            email: currentUser.email,
            name: userName,
          },
        ];

    return Array.from(
      new Map(baseUsers.map((user) => [user.id, user])).values(),
    );
  }, [currentUser, userName, usersOnline]);

  const typingCopy =
    typingUsers.length === 0
      ? "Nobody is typing right now."
      : typingUsers.length === 1
        ? `${typingUsers[0]} is typing...`
        : `${typingUsers.length} people are typing...`;

  const onlineCount = onlineUsers.length;
  const remainingCharacters = MAX_MESSAGE_LENGTH - newMessage.length;
  const isBooting = !hasResolvedSession;

  useEffect(() => {
    if (!supabase) {
      return undefined;
    }

    let isMounted = true;

    supabase.auth
      .getSession()
      .then(({ data: { session: currentSession } }) => {
        if (!isMounted) {
          return;
        }

        setSession(currentSession);
        setStatusMessage(
          currentSession ? DEFAULT_STATUS : "Sign in to join the room.",
        );
      })
      .catch(() => {
        if (!isMounted) {
          return;
        }

        setSession(null);
        setStatusMessage("Could not restore your session.");
      })
      .finally(() => {
        if (isMounted) {
          setHasResolvedSession(true);
        }
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);

      if (!nextSession) {
        setMessages([]);
        setUsersOnline([]);
        setTypingUsers([]);
        setMessagesError("");
      }

      setStatusMessage(nextSession ? DEFAULT_STATUS : "Signed out.");
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !currentUser) {
      return undefined;
    }

    let isActive = true;

    const loadMessages = async () => {
      setIsLoadingMessages(true);
      setMessagesError("");
      setStatusMessage(LOADING_STATUS);

      const { data, error } = await supabase
        .from("messages")
        .select(
          "id, user_id, email, avatar_url, body, created_at, delivered_at, seen_at",
        )
        .order("created_at", { ascending: true });

      if (!isActive) {
        return;
      }

      if (error) {
        setMessagesError(error.message);
        setStatusMessage("Failed to load messages.");
        setIsLoadingMessages(false);
        return;
      }

      setMessages(data ?? []);
      setStatusMessage(DEFAULT_STATUS);
      setIsLoadingMessages(false);
      seenQueueRef.current = true;
    };

    void loadMessages();

    const roomChannel = supabase.channel("room_one", {
      config: {
        presence: {
          key: currentUser.id,
        },
      },
    });

    roomChannelRef.current = roomChannel;

    roomChannel.on("presence", { event: "sync" }, () => {
      const presenceState = roomChannel.presenceState();
      const { participants, typingUsers: activeTypers } = getPresenceSnapshot(
        presenceState,
        currentUser.id,
      );
      setUsersOnline(participants);
      setTypingUsers(activeTypers);
    });

    roomChannel.subscribe(async (channelStatus) => {
      if (channelStatus === "SUBSCRIBED") {
        await roomChannel.track({
          id: currentUser.id,
          email: currentUser.email,
          name: userName,
          typing: false,
          onlineAt: new Date().toISOString(),
        });
      }
    });

    const messagesChannel = supabase
      .channel("messages-feed")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          setMessages((currentMessages) =>
            mergeMessages(currentMessages, [payload.new]),
          );
          setStatusMessage("New message received live.");
          seenQueueRef.current = true;
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          setMessages((currentMessages) =>
            mergeMessages(currentMessages, [payload.new]),
          );
        },
      )
      .subscribe();

    return () => {
      isActive = false;
      roomChannelRef.current = null;
      roomChannel.unsubscribe();
      messagesChannel.unsubscribe();
    };
  }, [currentUser, userName]);

  useEffect(() => {
    const roomChannel = roomChannelRef.current;

    if (!roomChannel || !currentUser) {
      return undefined;
    }

    void roomChannel.track({
      id: currentUser.id,
      email: currentUser.email,
      name: userName,
      typing: isTyping,
      onlineAt: new Date().toISOString(),
    });

    return undefined;
  }, [currentUser, isTyping, userName]);

  useEffect(() => {
    if (!supabase || !currentUser || messages.length === 0 || !seenQueueRef.current) {
      return;
    }

    const unseenIncomingMessages = messages.filter(
      (message) => message.user_id !== currentUser.id && !message.seen_at,
    );

    if (unseenIncomingMessages.length === 0) {
      seenQueueRef.current = false;
      return;
    }

    seenQueueRef.current = false;

    void supabase
      .from("messages")
      .update({ seen_at: new Date().toISOString() })
      .in(
        "id",
        unseenIncomingMessages.map((message) => message.id),
      );
  }, [currentUser, messages]);

  useEffect(() => {
    if (!chatContainerRef.current) {
      return;
    }

    chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
  }, [messages, typingUsers]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  const queueTypingReset = () => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
    }, 1400);
  };

  const signIn = async () => {
    if (!supabase) {
      return;
    }

    setStatusMessage("Redirecting to Google...");

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
    });

    if (error) {
      setStatusMessage(error.message);
    }
  };

  const signOut = async () => {
    if (!supabase) {
      return;
    }

    const { error } = await supabase.auth.signOut();

    if (error) {
      setStatusMessage(error.message);
      return;
    }

    setMessages([]);
    setUsersOnline([]);
    setTypingUsers([]);
    setStatusMessage("Signed out.");
  };

  const sendMessage = async (event) => {
    event.preventDefault();

    if (!supabase || !currentUser) {
      return;
    }

    const body = newMessage.trim();

    if (!body || body.length > MAX_MESSAGE_LENGTH || isSending) {
      return;
    }

    setIsSending(true);
    setStatusMessage("Sending message...");

    const now = new Date().toISOString();
    const { error } = await supabase.from("messages").insert({
      user_id: currentUser.id,
      email: currentUser.email ?? "Unknown user",
      avatar_url: currentUser.user_metadata?.avatar_url ?? null,
      body,
      delivered_at: now,
    });

    setIsSending(false);

    if (error) {
      setStatusMessage(error.message);
      return;
    }

    setNewMessage("");
    setIsTyping(false);
    setIsEmojiPickerOpen(false);
    setStatusMessage("Message delivered.");
  };

  const handleMessageChange = (event) => {
    const nextValue = event.target.value.slice(0, MAX_MESSAGE_LENGTH);
    setNewMessage(nextValue);

    if (nextValue.trim()) {
      setIsTyping(true);
      queueTypingReset();
    } else {
      setIsTyping(false);
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    }
  };

  const insertEmoji = (emoji) => {
    setNewMessage((currentMessage) =>
      `${currentMessage}${currentMessage ? " " : ""}${emoji}`.slice(
        0,
        MAX_MESSAGE_LENGTH,
      ),
    );
    setIsTyping(true);
    queueTypingReset();
  };

  if (isBooting) {
    return (
      <AuthShell
        badge="Session Check"
        title="Preparing your workspace"
        description="We are validating your session and warming up realtime channels."
        statusMessage={statusMessage}
      >
        <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/10 border-t-amber-300" />
      </AuthShell>
    );
  }

  if (supabaseConfigError) {
    return (
      <AuthShell
        badge="Missing Environment Variables"
        title="Setup needed"
        description="Create a .env file and add VITE_SUPABASE_URL plus VITE_SUPABASE_ANON_KEY before running the app."
        statusMessage={supabaseConfigError}
      >
        <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-100">
          The Supabase client is disabled until the environment variables are
          present.
        </div>
      </AuthShell>
    );
  }

  if (!currentUser) {
    return (
      <AuthShell
        badge="Google Workspace Ready"
        title="Enter the room"
        description="Sign in with Google to join the shared chat, track who is online, and sync messages instantly."
        statusMessage={statusMessage}
      >
        <button
          onClick={signIn}
          className="inline-flex w-full max-w-sm items-center justify-center rounded-2xl bg-amber-300 px-5 py-4 text-sm font-semibold text-slate-950 transition hover:bg-amber-200"
        >
          Sign in with Google
        </button>
      </AuthShell>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.14),transparent_24%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.18),transparent_28%),linear-gradient(135deg,#020617_0%,#0f172a_46%,#111827_100%)] px-4 py-4 text-slate-50 sm:px-6 lg:px-8">
      <section className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-7xl flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/55 shadow-2xl shadow-black/35 backdrop-blur-xl lg:grid lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="border-b border-white/10 bg-white/5 p-5 lg:border-b-0 lg:border-r">
          <div className="space-y-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-amber-300">
                Realtime Workspace
              </p>
              <h1 className="mt-3 font-['Cormorant_Garamond'] text-5xl leading-none text-white">
                Together
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                A cleaner room with online presence, typing activity, and
                delivery state.
              </p>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-3">
                <Avatar
                  src={currentUser.user_metadata?.avatar_url}
                  alt={userName}
                  fallback={getInitials(currentUser.email)}
                  size="lg"
                />
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
                    Signed in as
                  </p>
                  <p className="truncate text-lg font-semibold text-white">
                    {userName}
                  </p>
                  <p className="truncate text-sm text-slate-400">
                    {currentUser.email}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <p className="text-3xl font-semibold text-white">{onlineCount}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">
                  Online users
                </p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <p className="text-3xl font-semibold text-white">
                  {messages.length}
                </p>
                <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-400">
                  Messages
                </p>
              </div>
            </div>

            <div className="rounded-3xl border border-emerald-300/15 bg-emerald-400/10 p-4 text-sm text-emerald-100">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.8)]" />
                <span>{statusMessage}</span>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
                  Online now
                </p>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300">
                  {onlineCount}
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {onlineUsers.map((user) => (
                  <div key={user.id} className="flex items-center gap-3">
                    <Avatar
                      src={user.avatar_url}
                      alt={user.name || user.email}
                      fallback={getInitials(user.email)}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">
                        {user.id === currentUserId ? "You" : user.name || user.email}
                      </p>
                      <p className="truncate text-xs text-slate-400">
                        {user.email}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
                Latest activity
              </p>
              <p className="mt-3 text-sm font-semibold text-white">
                {latestMessage ? latestMessage.email : "Room is quiet"}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                {latestMessage
                  ? latestMessage.body
                  : "The next message sent in this room will show up here."}
              </p>
            </div>

            <button
              onClick={signOut}
              className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/10"
            >
              Sign out
            </button>
          </div>
        </aside>

        <div className="flex min-h-0 flex-col">
          <header className="border-b border-white/10 px-5 py-5 sm:px-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-amber-300">
                  Main room
                </p>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  Live conversation
                </h2>
                <p className="mt-2 text-sm text-slate-400">{typingCopy}</p>
              </div>
              <div className="inline-flex items-center gap-2 self-start rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.8)]" />
                {onlineCount} active
              </div>
            </div>
          </header>

          <div
            ref={chatContainerRef}
            className="flex-1 space-y-5 overflow-y-auto px-5 py-6 sm:px-7"
          >
            {isLoadingMessages ? (
              <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-center text-slate-300">
                Loading conversation...
              </div>
            ) : messagesError ? (
              <div className="rounded-3xl border border-red-400/20 bg-red-500/10 p-6 text-center text-red-100">
                {messagesError}
              </div>
            ) : messages.length === 0 ? (
              <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center">
                <p className="text-lg font-medium text-white">No messages yet</p>
                <p className="mt-2 text-sm text-slate-400">
                  Start the room with a sharp first message.
                </p>
              </div>
            ) : (
              messages.map((message, index) => {
                const isCurrentUser = message.user_id === currentUserId;
                const previousMessage = messages[index - 1];
                const showDayLabel =
                  !previousMessage ||
                  formatDay(previousMessage.created_at) !==
                    formatDay(message.created_at);
                const messageStatus = getMessageStatus(
                  message,
                  onlineUsers,
                  currentUserId,
                );

                return (
                  <div key={message.id}>
                    {showDayLabel ? (
                      <div className="mb-5 flex items-center gap-4">
                        <div className="h-px flex-1 bg-white/10" />
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-400">
                          {formatDay(message.created_at)}
                        </span>
                        <div className="h-px flex-1 bg-white/10" />
                      </div>
                    ) : null}

                    <article
                      className={`flex gap-3 ${
                        isCurrentUser ? "justify-end" : "justify-start"
                      }`}
                    >
                      {!isCurrentUser ? (
                        <Avatar
                          src={message.avatar_url}
                          alt={message.email}
                          fallback={getInitials(message.email)}
                        />
                      ) : null}

                      <div className="max-w-[min(100%,44rem)]">
                        <div
                          className={`rounded-[1.6rem] border px-4 py-3 shadow-lg shadow-black/10 ${
                            isCurrentUser
                              ? "rounded-br-md border-amber-200/20 bg-gradient-to-br from-amber-200 to-amber-400 text-slate-950"
                              : "rounded-bl-md border-white/10 bg-white/6 text-slate-50 backdrop-blur-sm"
                          }`}
                        >
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <p
                              className={`text-xs font-semibold uppercase tracking-[0.16em] ${
                                isCurrentUser ? "text-slate-900/70" : "text-slate-400"
                              }`}
                            >
                              {isCurrentUser ? "You" : message.email}
                            </p>
                            <p
                              className={`text-xs ${
                                isCurrentUser ? "text-slate-900/70" : "text-slate-500"
                              }`}
                            >
                              {formatTime(message.created_at)}
                            </p>
                          </div>
                          <p className="whitespace-pre-wrap break-words text-sm leading-7 sm:text-[15px]">
                            {message.body}
                          </p>
                        </div>
                        <div
                          className={`mt-2 flex items-center gap-2 text-xs text-slate-500 ${
                            isCurrentUser ? "justify-end" : "justify-start"
                          }`}
                        >
                          <span>{formatTime(message.created_at)}</span>
                          {isCurrentUser && messageStatus ? (
                            <>
                              <span className="text-slate-600">•</span>
                              <span>{messageStatus}</span>
                            </>
                          ) : null}
                        </div>
                      </div>

                      {isCurrentUser ? (
                        <Avatar
                          src={message.avatar_url}
                          alt={message.email}
                          fallback={getInitials(message.email)}
                        />
                      ) : null}
                    </article>
                  </div>
                );
              })
            )}

            {typingUsers.length > 0 ? (
              <div className="flex items-center gap-3">
                <div className="flex gap-1 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.3s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.15s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300" />
                </div>
                <p className="text-sm text-slate-400">{typingCopy}</p>
              </div>
            ) : null}
          </div>

          <form
            onSubmit={sendMessage}
            className="border-t border-white/10 bg-slate-950/60 px-5 py-5 sm:px-7"
          >
            <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
                    Composer
                  </p>
                  <p className="mt-1 text-sm text-slate-400">
                    Message timestamp, delivery state, emoji picker, and typing
                    presence are all active.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsEmojiPickerOpen((current) => !current)}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/10"
                >
                  <span>😄</span>
                  Emoji picker
                </button>
              </div>

              {isEmojiPickerOpen ? (
                <div className="mb-4 grid grid-cols-8 gap-2 rounded-2xl border border-white/10 bg-slate-950/60 p-3 sm:grid-cols-10">
                  {EMOJI_OPTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => insertEmoji(emoji)}
                      className="rounded-xl border border-white/8 bg-white/5 p-2 text-xl transition hover:bg-white/10"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div>
                  <textarea
                    value={newMessage}
                    onChange={handleMessageChange}
                    rows={4}
                    placeholder="Write something useful, clear, and worth reading..."
                    className="min-h-28 w-full resize-none rounded-3xl border border-white/10 bg-slate-950/60 px-4 py-4 text-sm leading-7 text-white placeholder:text-slate-500 focus:border-amber-300/35 focus:outline-none"
                  />
                  <div className="mt-3 flex flex-col gap-2 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
                    <span>{remainingCharacters} characters left</span>
                    <span>Press send to publish. Typing status updates live.</span>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={
                    isSending ||
                    !newMessage.trim() ||
                    newMessage.length > MAX_MESSAGE_LENGTH
                  }
                  className="inline-flex min-h-14 items-center justify-center rounded-2xl bg-amber-300 px-6 py-4 text-sm font-semibold text-slate-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-amber-300/50"
                >
                  {isSending ? "Sending..." : "Send message"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}

export default App;

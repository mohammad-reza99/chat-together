import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, supabaseConfigError } from "./lib/supabase";

const DEFAULT_STATUS = "Connected to the room.";
const LOADING_STATUS = "Loading messages...";
const QUICK_EMOJIS = ["🔥", "😂", "❤️", "👏", "🎯", "🚀", "😎", "👀"];

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

function Avatar({ src, alt, fallback }) {
  if (src) {
    return <img src={src} alt={alt} className="avatar" />;
  }

  return <div className="avatar avatar-fallback">{fallback}</div>;
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function getPresenceSnapshot(presenceState, currentUserId) {
  const participants = [];
  const typingNames = new Set();

  Object.values(presenceState).forEach((entries) => {
    entries.forEach((entry) => {
      participants.push(entry);

      if (entry.id !== currentUserId && entry.typing) {
        typingNames.add(entry.name || entry.email || "Someone");
      }
    });
  });

  return {
    participants,
    typingUsers: Array.from(typingNames),
  };
}

function App() {
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [usersOnline, setUsersOnline] = useState([]);
  const [statusMessage, setStatusMessage] = useState(
    supabaseConfigError || "Checking your session...",
  );
  const [hasResolvedSession, setHasResolvedSession] = useState(
    Boolean(supabaseConfigError),
  );
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [messagesError, setMessagesError] = useState("");
  const [typingUsers, setTypingUsers] = useState([]);

  const chatContainerRef = useRef(null);
  const roomChannelRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const latestMessage = useMemo(() => {
    if (messages.length === 0) {
      return null;
    }

    return messages[messages.length - 1];
  }, [messages]);

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
    if (!supabase || !session?.user) {
      return undefined;
    }

    let isActive = true;

    const loadMessages = async () => {
      setIsLoadingMessages(true);
      setMessagesError("");
      setStatusMessage(LOADING_STATUS);

      const { data, error } = await supabase
        .from("messages")
        .select("id, user_id, email, avatar_url, body, created_at")
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
    };

    loadMessages();

    const roomChannel = supabase.channel("room_one", {
      config: {
        presence: {
          key: session.user.id,
        },
      },
    });

    roomChannelRef.current = roomChannel;

    roomChannel.on("presence", { event: "sync" }, () => {
      const presenceState = roomChannel.presenceState();
      const { participants, typingUsers: activeTypers } = getPresenceSnapshot(
        presenceState,
        session.user.id,
      );
      setUsersOnline(participants);
      setTypingUsers(activeTypers);
    });

    roomChannel.subscribe(async (channelStatus) => {
      if (channelStatus === "SUBSCRIBED") {
        await roomChannel.track({
          id: session.user.id,
          email: session.user.email,
          name:
            session.user.user_metadata?.full_name ||
            session.user.user_metadata?.name ||
            session.user.email,
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
        },
      )
      .subscribe();

    return () => {
      isActive = false;
      roomChannelRef.current = null;
      roomChannel.unsubscribe();
      messagesChannel.unsubscribe();
    };
  }, [session]);

  useEffect(() => {
    const roomChannel = roomChannelRef.current;

    if (!roomChannel || !session?.user) {
      return undefined;
    }

    void roomChannel.track({
      id: session.user.id,
      email: session.user.email,
      name:
        session.user.user_metadata?.full_name ||
        session.user.user_metadata?.name ||
        session.user.email,
      typing: isTyping,
      onlineAt: new Date().toISOString(),
    });

    return undefined;
  }, [isTyping, session]);

  useEffect(() => {
    if (!session?.user) {
      return undefined;
    }

    const hasDraft = newMessage.trim().length > 0;

    if (hasDraft) {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      typingTimeoutRef.current = setTimeout(() => {
        setIsTyping(false);
      }, 1400);
    }

    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, [isTyping, newMessage, session]);

  useEffect(() => {
    if (!chatContainerRef.current) {
      return;
    }

    chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
  }, [messages]);

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
    setStatusMessage("Signed out.");
  };

  const sendMessage = async (event) => {
    event.preventDefault();

    if (!supabase) {
      return;
    }

    const body = newMessage.trim();
    if (!body || body.length > 500 || !session?.user || isSending) {
      return;
    }

    setIsSending(true);
    setStatusMessage("Sending message...");

    const { error } = await supabase.from("messages").insert({
      user_id: session.user.id,
      email: session.user.email ?? "Unknown user",
      avatar_url: session.user.user_metadata?.avatar_url ?? null,
      body,
    });

    setIsSending(false);

    if (error) {
      setStatusMessage(error.message);
      return;
    }

    setIsTyping(false);
    setNewMessage("");
    setStatusMessage("Message delivered.");
  };

  const userName =
    session?.user?.user_metadata?.full_name ||
    session?.user?.user_metadata?.name ||
    session?.user?.email;

  const onlineCount = usersOnline.length || (session?.user ? 1 : 0);
  const isBooting = !hasResolvedSession;
  const typingCopy =
    typingUsers.length === 0
      ? ""
      : typingUsers.length === 1
        ? `${typingUsers[0]} is typing...`
        : `${typingUsers.length} people are typing...`;

  const insertEmoji = (emoji) => {
    setNewMessage((currentMessage) =>
      currentMessage ? `${currentMessage} ${emoji}` : emoji,
    );
    setIsTyping(true);
  };

  const handleMessageChange = (event) => {
    const nextValue = event.target.value;
    setNewMessage(nextValue);
    setIsTyping(nextValue.trim().length > 0);
  };

  if (isBooting) {
    return (
      <main className="app-shell">
        <div className="ambient ambient-left" />
        <div className="ambient ambient-right" />

        <section className="auth-card">
          <div className="auth-copy">
            <p className="eyebrow">Private Social Lounge</p>
            <h1>Together</h1>
            <p className="hero-text">
              Premium realtime chat with a calm, cinematic interface built for
              fast conversation and clean focus.
            </p>
          </div>

          <div className="auth-panel">
            <div className="auth-badge">Session Check</div>
            <h2>Preparing the room</h2>
            <p className="panel-copy">
              We are validating your session and warming up the realtime
              connection.
            </p>
            <p className="status-line">{statusMessage}</p>
          </div>
        </section>
      </main>
    );
  }

  if (supabaseConfigError) {
    return (
      <main className="app-shell">
        <div className="ambient ambient-left" />
        <div className="ambient ambient-right" />

        <section className="auth-card">
          <div className="auth-copy">
            <p className="eyebrow">Configuration Required</p>
            <h1>Together</h1>
            <p className="hero-text">
              Add your Supabase project credentials before trying to sign in.
            </p>
          </div>

          <div className="auth-panel">
            <div className="auth-badge">Missing Environment Vars</div>
            <h2>Setup needed</h2>
            <p className="panel-copy">
              Create a <code>.env</code> file with{" "}
              <code>VITE_SUPABASE_URL</code> and{" "}
              <code>VITE_SUPABASE_ANON_KEY</code>.
            </p>
            <p className="status-line">{supabaseConfigError}</p>
          </div>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="app-shell">
        <div className="ambient ambient-left" />
        <div className="ambient ambient-right" />

        <section className="auth-card">
          <div className="auth-copy">
            <p className="eyebrow">Private Social Lounge</p>
            <h1>Together</h1>
            <p className="hero-text">
              Premium realtime chat with a calm, cinematic interface built for
              fast conversation, visible presence, and clean focus.
            </p>
          </div>

          <div className="auth-panel">
            <div className="auth-badge">Google Workspace Ready</div>
            <h2>Enter the room</h2>
            <p className="panel-copy">
              Sign in with Google to join the shared room, track who is online,
              and exchange messages instantly.
            </p>

            <button onClick={signIn} className="primary-button auth-button">
              Sign in with Google
            </button>

            <p className="status-line">{statusMessage}</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />

      <section className="chat-frame">
        <aside className="sidebar-panel">
          <div className="sidebar-top">
            <p className="eyebrow">Realtime Suite</p>
            <h2>Conversation Deck</h2>
            <p className="sidebar-copy">
              Shared room for fast updates, live presence, and premium visual
              clarity.
            </p>
          </div>

          <div className="identity-card">
            <Avatar
              src={session.user.user_metadata?.avatar_url}
              alt={userName}
              fallback={getInitials(session.user.email)}
            />
            <div>
              <p className="identity-label">Signed in as</p>
              <strong className="identity-name">{userName}</strong>
              <p className="identity-email">{session.user.email}</p>
            </div>
          </div>

          <div className="metric-grid">
            <article className="metric-card">
              <span className="metric-value">{onlineCount}</span>
              <span className="metric-label">online now</span>
            </article>
            <article className="metric-card">
              <span className="metric-value">{messages.length}</span>
              <span className="metric-label">messages</span>
            </article>
          </div>

          <div className="status-card">
            <span className="status-dot" />
            <p>{statusMessage}</p>
          </div>

          <div className="insight-card">
            <p className="insight-label">Latest activity</p>
            <strong className="insight-title">
              {latestMessage ? latestMessage.email : "Room is quiet"}
            </strong>
            <p className="insight-copy">
              {latestMessage
                ? latestMessage.body
                : "The first useful message will show up here."}
            </p>
          </div>

          <button onClick={signOut} className="secondary-button">
            Sign out
          </button>
        </aside>

        <div className="chat-panel">
          <header className="chat-header">
            <div>
              <p className="eyebrow">Main Room</p>
              <h1>Live conversation</h1>
              <p className="typing-indicator">{typingCopy || "Realtime sync is active."}</p>
            </div>
            <div className="presence-pill">
              <span className="presence-glow" />
              {onlineCount} active
            </div>
          </header>

          <div ref={chatContainerRef} className="message-stream">
            {isLoadingMessages ? (
              <div className="empty-state">
                <p className="empty-title">Loading conversation</p>
                <p className="empty-copy">
                  Pulling the latest messages from Supabase.
                </p>
              </div>
            ) : messagesError ? (
              <div className="empty-state">
                <p className="empty-title">Could not load messages</p>
                <p className="empty-copy">{messagesError}</p>
              </div>
            ) : messages.length === 0 ? (
              <div className="empty-state">
                <p className="empty-title">No messages yet</p>
                <p className="empty-copy">
                  Start the room with a first message. Everyone connected to
                  this shared chat will see it live.
                </p>
              </div>
            ) : (
              messages.map((message) => {
                const isCurrentUser = message.user_id === session.user.id;

                return (
                  <article
                    key={message.id}
                    className={`message-row ${
                      isCurrentUser ? "message-row-self" : ""
                    }`}
                  >
                    {!isCurrentUser && (
                      <Avatar
                        src={message.avatar_url}
                        alt={message.email}
                        fallback={getInitials(message.email)}
                      />
                    )}

                    <div className="message-column">
                      <div
                        className={`message-bubble ${
                          isCurrentUser ? "message-bubble-self" : ""
                        }`}
                      >
                        <p className="message-author">{message.email}</p>
                        <p className="message-body">{message.body}</p>
                      </div>
                      <p
                        className={`message-time ${
                          isCurrentUser ? "message-time-self" : ""
                        }`}
                      >
                        {formatTime(message.created_at)}
                      </p>
                    </div>

                    {isCurrentUser && (
                      <Avatar
                        src={message.avatar_url}
                        alt={message.email}
                        fallback={getInitials(message.email)}
                      />
                    )}
                  </article>
                );
              })
            )}
          </div>

          <form onSubmit={sendMessage} className="composer">
            <div className="composer-field">
              <label htmlFor="message" className="composer-label">
                New message
              </label>
              <div className="emoji-row">
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="emoji-button"
                    onClick={() => insertEmoji(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <textarea
                id="message"
                value={newMessage}
                onChange={handleMessageChange}
                rows="3"
                placeholder="Write something sharp, clear, and worth reading..."
                className="composer-input composer-textarea"
              />
              <div className="composer-meta">
                <span>{newMessage.trim().length}/500</span>
                <span>Enter = new line, click send to publish</span>
              </div>
            </div>

            <button
              disabled={
                isSending ||
                !newMessage.trim() ||
                newMessage.trim().length > 500
              }
              className="primary-button send-button"
            >
              {isSending ? "Sending..." : "Send message"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

export default App;

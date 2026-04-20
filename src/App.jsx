import { useEffect, useRef, useState } from "react";
import { supabase } from "../supbaseClient";

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

function App() {
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [usersOnline, setUsersOnline] = useState([]);
  const [statusMessage, setStatusMessage] = useState("Connecting...");
  const [isSending, setIsSending] = useState(false);

  const chatContainerRef = useRef(null);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        setSession(session);
      })
      .catch(() => {
        setSession(null);
        setStatusMessage("Could not restore your session.");
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) {
      return undefined;
    }

    let isActive = true;

    const loadMessages = async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, user_id, email, avatar_url, body, created_at")
        .order("created_at", { ascending: true });

      if (!isActive) {
        return;
      }

      if (error) {
        setStatusMessage(error.message);
        return;
      }

      setMessages(data ?? []);
      setStatusMessage("Connected.");
    };

    loadMessages();

    const roomOne = supabase.channel("room_one", {
      config: {
        presence: {
          key: session.user.id,
        },
      },
    });

    roomOne.on("presence", { event: "sync" }, () => {
      const state = roomOne.presenceState();
      setUsersOnline(Object.keys(state));
    });

    roomOne.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await roomOne.track({
          id: session.user.id,
          email: session.user.email,
        });
      }
    });

    const messagesChannel = supabase
      .channel(`messages:${session.user.id}`)
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
        },
      )
      .subscribe();

    return () => {
      isActive = false;
      roomOne.unsubscribe();
      messagesChannel.unsubscribe();
    };
  }, [session]);

  useEffect(() => {
    if (!chatContainerRef.current) {
      return;
    }

    chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
  }, [messages]);

  const signIn = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
    });

    if (error) {
      setStatusMessage(error.message);
    }
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      setStatusMessage(error.message);
      return;
    }

    setStatusMessage("Signed out.");
  };

  const sendMessage = async (event) => {
    event.preventDefault();

    const body = newMessage.trim();
    if (!body || !session?.user) {
      return;
    }

    setIsSending(true);

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

    setNewMessage("");
    setStatusMessage("Message sent.");
  };

  const formatTime = (isoString) =>
    new Date(isoString).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

  const userName =
    session?.user?.user_metadata?.full_name ||
    session?.user?.user_metadata?.name ||
    session?.user?.email;

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
              fast conversation and clean focus.
            </p>
          </div>

          <div className="auth-panel">
            <div className="auth-badge">Google Workspace Ready</div>
            <h2>Enter the room</h2>
            <p className="panel-copy">
              Sign in with Google to join the shared room, see who is online,
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
              <span className="metric-value">{usersOnline.length}</span>
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

          <button onClick={signOut} className="secondary-button">
            Sign out
          </button>
        </aside>

        <div className="chat-panel">
          <header className="chat-header">
            <div>
              <p className="eyebrow">Main Room</p>
              <h1>Live conversation</h1>
            </div>
            <div className="presence-pill">
              <span className="presence-glow" />
              {usersOnline.length} active
            </div>
          </header>

          <div ref={chatContainerRef} className="message-stream">
            {messages.length === 0 ? (
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
              <input
                id="message"
                value={newMessage}
                onChange={(event) => setNewMessage(event.target.value)}
                type="text"
                placeholder="Write something sharp, clear, and worth reading..."
                className="composer-input"
              />
            </div>

            <button disabled={isSending} className="primary-button send-button">
              {isSending ? "Sending..." : "Send message"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

export default App;

import { useMemo, useState } from "react";

function normalizeRoomId(value) {
  return value.trim().replace(/\s+/g, "-");
}

export default function Home({ onJoin }) {
  const [email, setEmail] = useState("");
  const [roomId, setRoomId] = useState("");
  const [submitted, setSubmitted] = useState(null);

  const normalizedRoomId = useMemo(() => normalizeRoomId(roomId), [roomId]);
  const isEmailValid = useMemo(() => {
    if (!email) return false;
    // Lightweight check; rely on browser email validation for strictness.
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }, [email]);

  const canJoin = isEmailValid && normalizedRoomId.length > 0;

  function handleSubmit(event) {
    event.preventDefault();
    if (!canJoin) return;

    const payload = { email: email.trim(), roomId: normalizedRoomId };
    setSubmitted(payload);

    if (typeof onJoin === "function") onJoin(payload);
  }

  return (
    <main className="container">
      <header className="pageHeader">
        <h1 className="title">Video Call Lobby</h1>
        <p className="subtitle">Enter your email and a room ID to join a call.</p>
      </header>

      <section className="card" aria-label="Join a room">
        <form className="form" onSubmit={handleSubmit}>
          <label className="field">
            <span className="labelText">Email</span>
            <input
              className="input"
              type="email"
              name="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label className="field">
            <span className="labelText">Room ID</span>
            <input
              className="input"
              type="text"
              name="roomId"
              autoComplete="off"
              placeholder="e.g. team-standup"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              required
            />
            <span className="hint">
              We&apos;ll normalize spaces to hyphens:{" "}
              <code>{normalizedRoomId || "room-id"}</code>
            </span>
          </label>

          <div className="actions">
            <button className="btn" type="submit" disabled={!canJoin}>
              Join Room
            </button>
          </div>
        </form>
      </section>

      {submitted ? (
        <section className="notice" aria-label="Join details">
          <strong>Ready:</strong> joining <code>{submitted.roomId}</code> as{" "}
          <code>{submitted.email}</code>.
        </section>
      ) : null}
    </main>
  );
}

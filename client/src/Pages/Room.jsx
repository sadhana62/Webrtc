import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { useSocket } from "../contexts/SocketContext.jsx";
import { usePeer } from "../contexts/PeerContext.jsx";

export default function Room() {
  const { roomId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { socket, connected } = useSocket();
  const {
    ensurePeer,
    initLocalStream,
    localStream,
    remoteStream,
    createOffer,
    createAnswer,
    setRemoteAnswer,
    addIceCandidate,
    setLocalVideoEnabled,
  } = usePeer();
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [selfVideoOn, setSelfVideoOn] = useState(true);
  const [selfAudioOn, setSelfAudioOn] = useState(true);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const email = useMemo(() => searchParams.get("email") ?? "", [searchParams]);

  useEffect(() => {
    if (!socket || !connected || !roomId) return;

    console.log("[socket] emitting room:join", { roomId, email });
    socket.emit("room:join", { roomId, email });

    const onJoined = (payload) => console.log("[socket] room:joined", payload);
    const onUserJoined = (payload) => console.log("[socket] room:user-joined", payload);

    socket.on("room:joined", onJoined);
    socket.on("room:user-joined", onUserJoined);

    return () => {
      socket.off("room:joined", onJoined);
      socket.off("room:user-joined", onUserJoined);
    };
  }, [socket, connected, roomId, email]);

  useEffect(() => {
    // Prepare peer + capture local media as soon as user enters the room.
    let cancelled = false;

    (async () => {
      try {
        await initLocalStream({ audio: true, video: true });
        if (!cancelled) {
          setMediaError("");
          setMediaReady(true);
        }
      } catch (err) {
        const msg = err?.message || String(err);
        console.log("[webrtc] init failed", msg);
        if (!cancelled) {
          setMediaReady(false);
          setMediaError(msg);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initLocalStream]);

  useEffect(() => {
    if (!localVideoRef.current) return;
    if (!localStream) return;
    localVideoRef.current.srcObject = localStream;
  }, [localStream, selfVideoOn]);

  useEffect(() => {
    const remoteVideo = remoteVideoRef.current;
    if (!remoteVideo) return;
    if (!remoteStream) {
      remoteVideo.srcObject = null;
      return;
    }

    remoteVideo.srcObject = remoteStream;
    const startPlayback = () => {
      remoteVideo.play().catch((err) => {
        console.log("[webrtc] remote playback blocked", err?.message || err);
      });
    };

    startPlayback();
    remoteVideo.onloadedmetadata = startPlayback;

    return () => {
      remoteVideo.onloadedmetadata = null;
    };
  }, [remoteStream]);

  useEffect(() => {
    if (!socket || !connected || !roomId) return;

    const peer = ensurePeer();

    peer.onicecandidate = (event) => {
      if (!event.candidate) return;
      socket.emit("webrtc:ice-candidate", {
        roomId,
        candidate: event.candidate.toJSON?.() ?? event.candidate,
      });
    };

    peer.onconnectionstatechange = () => {
      console.log("[webrtc] connectionState", peer.connectionState);
    };
    peer.oniceconnectionstatechange = () => {
      console.log("[webrtc] iceConnectionState", peer.iceConnectionState);
    };

    const onUserJoined = async ({ id } = {}) => {
      console.log("[webrtc] peer joined", id);
    };

    const onOffer = async ({ from, offer } = {}) => {
      console.log("[webrtc] received offer from", from);
      try {
        if (!localStream) await initLocalStream({ audio: true, video: true });
        const answer = await createAnswer(offer);
        socket.emit("webrtc:answer", { roomId, answer: answer?.toJSON?.() ?? answer });
      } catch (err) {
        console.log("[webrtc] createAnswer failed", err?.message || err);
      }
    };

    const onAnswer = async ({ from, answer } = {}) => {
      console.log("[webrtc] received answer from", from);
      try {
        await setRemoteAnswer(answer);
      } catch (err) {
        console.log("[webrtc] setRemoteAnswer failed", err?.message || err);
      }
    };

    const onIceCandidate = async ({ from, candidate } = {}) => {
      console.log("[webrtc] received ice-candidate from", from);
      try {
        await addIceCandidate(candidate);
      } catch (err) {
        console.log("[webrtc] addIceCandidate failed", err?.message || err);
      }
    };

    const onReady = async ({ from } = {}) => {
      if (!from) return;

      const currentPeer = ensurePeer();
      // A newly joined peer emits ready once. Existing peers should initiate.
      // Only create offers when stable to avoid overlapping negotiations.
      if (currentPeer.signalingState !== "stable") {
        console.log("[webrtc] skipping offer, signalingState=", currentPeer.signalingState);
        return;
      }

      console.log("[webrtc] peer ready, creating offer for", from);
      try {
        if (!localStream) await initLocalStream({ audio: true, video: true });
        const offer = await createOffer();
        socket.emit("webrtc:offer", { roomId, offer: offer?.toJSON?.() ?? offer });
      } catch (err) {
        console.log("[webrtc] createOffer failed", err?.message || err);
      }
    };

    socket.on("room:user-joined", onUserJoined);
    socket.on("webrtc:offer", onOffer);
    socket.on("webrtc:answer", onAnswer);
    socket.on("webrtc:ice-candidate", onIceCandidate);
    socket.on("webrtc:ready", onReady);

    return () => {
      peer.onicecandidate = null;
      peer.onconnectionstatechange = null;
      peer.oniceconnectionstatechange = null;
      socket.off("room:user-joined", onUserJoined);
      socket.off("webrtc:offer", onOffer);
      socket.off("webrtc:answer", onAnswer);
      socket.off("webrtc:ice-candidate", onIceCandidate);
      socket.off("webrtc:ready", onReady);
    };
  }, [
    socket,
    connected,
    roomId,
    createOffer,
    createAnswer,
    setRemoteAnswer,
    addIceCandidate,
    ensurePeer,
    initLocalStream,
    localStream,
  ]);

  // Emit ready only when media is fully initialized and socket is connected
  useEffect(() => {
    if (!socket || !connected || !roomId || !mediaReady) return;

    console.log("[socket] emitting webrtc:ready", { roomId });
    socket.emit("webrtc:ready", { roomId });
  }, [socket, connected, roomId, mediaReady]);

  const toggleSelfAudio = () => {
    if (!localStream) return;
    const next = !selfAudioOn;
    localStream.getAudioTracks().forEach((track) => {
      track.enabled = next;
    });
    setSelfAudioOn(next);
  };

  const toggleSelfVideo = async () => {
    try {
      const next = !selfVideoOn;
      await setLocalVideoEnabled(next);
      setSelfVideoOn(next);
    } catch (err) {
      console.log("[webrtc] toggle self video failed", err?.message || err);
    }
  };

  const retryMedia = async () => {
    try {
      await initLocalStream({ audio: true, video: true });
      setMediaError("");
      setMediaReady(true);
      setSelfVideoOn(true);
      setSelfAudioOn(true);
    } catch (err) {
      const msg = err?.message || String(err);
      console.log("[webrtc] retry media failed", msg);
      setMediaReady(false);
      setMediaError(msg);
    }
  };

  const handleExitCall = () => {
    try {
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
    } catch {
      // ignore
    }
    navigate("/");
  };

  return (
    <main className="container" style={{ position: "relative", minHeight: "90vh" }}>
      <header className="pageHeader" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1 className="title" style={{ fontSize: "28px", fontWeight: 800, background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            WebRTC Conference
          </h1>
          <p className="subtitle" style={{ marginTop: 4 }}>
            Room: <code style={{ color: "#4f46e5", fontWeight: 600 }}>{roomId}</code>
            {email ? <> • Connected as: <code>{email}</code></> : null}
          </p>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <div className="statusIndicator">
            <span className={`statusDot ${connected ? "connected" : "disconnected"}`} />
            <span>Socket: {connected ? "Connected" : "Disconnected"}</span>
          </div>
          <div className="statusIndicator">
            <span className={`statusDot ${mediaReady ? "connected" : "disconnected"}`} />
            <span>Media: {mediaReady ? "Ready" : "Pending"}</span>
          </div>
        </div>
      </header>

      <section className="roomCard" style={{ marginTop: 20 }}>
        {mediaError ? (
          <div
            style={{
              marginBottom: 20,
              padding: "12px 18px",
              borderRadius: 14,
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#b91c1c",
              fontWeight: 600,
              fontSize: "14px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center"
            }}
          >
            <span>Media Error: <code>{mediaError}</code></span>
            <button
              onClick={retryMedia}
              style={{
                background: "#ef4444",
                color: "#fff",
                border: 0,
                padding: "4px 10px",
                borderRadius: 8,
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              Resolve
            </button>
          </div>
        ) : null}

        <div className="videoFeedContainer">
          {/* Local User Feed */}
          <div className="videoWrapper">
            <div className="videoOverlay">You {email ? `(${email.split("@")[0]})` : ""}</div>
            
            {selfVideoOn ? (
              <video
                ref={localVideoRef}
                className="videoFeed"
                autoPlay
                muted
                playsInline
              />
            ) : (
              <div className="placeholderOverlay">
                <div className="avatarCircle">
                  {email ? email.charAt(0).toUpperCase() : "U"}
                </div>
                <div>Camera Turned Off</div>
              </div>
            )}
          </div>

          {/* Remote User Feed */}
          <div className="videoWrapper">
            <div className="videoOverlay">Remote Peer</div>
            
            {remoteStream && remoteStream.getTracks().length > 0 ? (
              <video
                ref={remoteVideoRef}
                className="videoFeed remoteVideoFeed"
                autoPlay
                playsInline
              />
            ) : (
              <div className="placeholderOverlay" style={{ background: "#0b0f19" }}>
                <div className="avatarCircle" style={{ background: "linear-gradient(135deg, #6b7280, #374151)", boxShadow: "0 8px 16px rgba(0,0,0,0.2)" }}>
                  👤
                </div>
                <div style={{ color: "#9ca3af" }}>Waiting for Remote Video...</div>
              </div>
            )}
          </div>
        </div>

        {/* Floating Glassmorphic Control Toolbar */}
        <div className="toolbarContainer">
          <div className="toolbar">
            <button
              type="button"
              onClick={toggleSelfAudio}
              className={`toolbarBtn ${selfAudioOn ? "active-blue" : "danger"}`}
              aria-label={selfAudioOn ? "Mute Microphone" : "Unmute Microphone"}
            >
              <span>{selfAudioOn ? "🎙️" : "🔇"}</span>
              <span className="tooltip">{selfAudioOn ? "Mute Mic" : "Unmute Mic"}</span>
            </button>

            <button
              type="button"
              onClick={toggleSelfVideo}
              className={`toolbarBtn ${selfVideoOn ? "active-blue" : "danger"}`}
              aria-label={selfVideoOn ? "Turn Camera Off" : "Turn Camera On"}
            >
              <span>{selfVideoOn ? "📹" : "📷"}</span>
              <span className="tooltip">{selfVideoOn ? "Disable Camera" : "Enable Camera"}</span>
            </button>

            <button
              type="button"
              onClick={retryMedia}
              className="toolbarBtn normal"
              aria-label="Refresh Camera Devices"
            >
              <span>🔄</span>
              <span className="tooltip">Reset Devices</span>
            </button>

            <div style={{ width: "1px", height: "24px", background: "rgba(255, 255, 255, 0.2)" }} />

            <button
              type="button"
              onClick={handleExitCall}
              className="toolbarBtn danger"
              style={{ background: "#dc2626", border: "1px solid #ef4444" }}
              aria-label="End Call"
            >
              <span>📞</span>
              <span className="tooltip">Disconnect</span>
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

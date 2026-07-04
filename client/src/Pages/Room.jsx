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
    setLocalAudioEnabled,
    resetPeerConnection,
    setPeerCallbacks,
    closePeer,
    stopLocalStream,
  } = usePeer();
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [selfVideoOn, setSelfVideoOn] = useState(true);
  const [selfAudioOn, setSelfAudioOn] = useState(true);
  const [remoteVideoOn, setRemoteVideoOn] = useState(true);
  const [remoteAudioOn, setRemoteAudioOn] = useState(true);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const email = useMemo(() => searchParams.get("email") ?? "", [searchParams]);

  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [showChat, setShowChat] = useState(false);
  const [peerConnectionState, setPeerConnectionState] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [toastNotification, setToastNotification] = useState(null);

  const showChatRef = useRef(showChat);
  useEffect(() => {
    showChatRef.current = showChat;
  }, [showChat]);
  const messagesEndRef = useRef(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Handle auto-dismissal of unread message toast notification
  useEffect(() => {
    if (!toastNotification) return;
    const timer = setTimeout(() => {
      setToastNotification(null);
    }, 4500);
    return () => clearTimeout(timer);
  }, [toastNotification]);

  const sendChatMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !socket || !roomId) return;

    const payload = {
      message: chatInput.trim(),
      sender: email || "Anonymous",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    socket.emit("chat:message", { roomId, ...payload });
    setMessages((prev) => [...prev, { ...payload, self: true }]);
    setChatInput("");
  };

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

    if (remoteVideo.srcObject !== remoteStream) {
      remoteVideo.srcObject = remoteStream;
    }
    
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

  // Set WebRTC peer callbacks using the delegator
  useEffect(() => {
    if (!socket || !roomId) return;
    setPeerCallbacks({
      onIceCandidate: (event) => {
        if (!event.candidate) return;
        socket.emit("webrtc:ice-candidate", {
          roomId,
          candidate: event.candidate.toJSON?.() ?? event.candidate,
        });
      },
      onConnectionStateChange: (state) => {
        console.log("[webrtc] connectionState changed:", state);
        setPeerConnectionState(state);
        if (state === "disconnected" || state === "failed" || state === "closed") {
          resetPeerConnection();
        }
      },
    });
  }, [socket, roomId, setPeerCallbacks, resetPeerConnection]);

  useEffect(() => {
    if (!socket || !connected || !roomId) return;

    const onUserJoined = async ({ id } = {}) => {
      console.log("[webrtc] peer joined", id);
    };

    const onUserLeft = ({ id } = {}) => {
      console.log("[webrtc] peer left", id);
      resetPeerConnection();
      setPeerConnectionState("disconnected");
      setRemoteVideoOn(true);
      setRemoteAudioOn(true);
    };

    const onMediaToggle = ({ kind, enabled } = {}) => {
      console.log("[webrtc] remote media toggled", { kind, enabled });
      if (kind === "video") {
        setRemoteVideoOn(enabled);
      } else if (kind === "audio") {
        setRemoteAudioOn(enabled);
      }
    };

    const onOffer = async ({ from, offer } = {}) => {
      console.log("[webrtc] received offer from", from);
      try {
        resetPeerConnection();
        await initLocalStream({ audio: true, video: true });
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

      console.log("[webrtc] peer ready, creating offer for", from);
      try {
        resetPeerConnection();
        await initLocalStream({ audio: true, video: true });
        const offer = await createOffer();
        socket.emit("webrtc:offer", { roomId, offer: offer?.toJSON?.() ?? offer });
      } catch (err) {
        console.log("[webrtc] createOffer failed", err?.message || err);
      }
    };

    const onChatMessage = (payload) => {
      console.log("[socket] received chat message", payload);
      setMessages((prev) => [...prev, { ...payload, self: false }]);
      
      // Increment unread messages and dispatch toast preview if chat panel is closed
      if (!showChatRef.current) {
        setUnreadCount((prev) => prev + 1);
        setToastNotification({
          sender: (payload.sender || "Anonymous").split("@")[0],
          message: payload.message,
          id: Date.now(),
        });
      }
    };

    socket.on("room:user-joined", onUserJoined);
    socket.on("room:user-left", onUserLeft);
    socket.on("webrtc:media-toggle", onMediaToggle);
    socket.on("webrtc:offer", onOffer);
    socket.on("webrtc:answer", onAnswer);
    socket.on("webrtc:ice-candidate", onIceCandidate);
    socket.on("webrtc:ready", onReady);
    socket.on("chat:message", onChatMessage);

    return () => {
      socket.off("room:user-joined", onUserJoined);
      socket.off("room:user-left", onUserLeft);
      socket.off("webrtc:media-toggle", onMediaToggle);
      socket.off("webrtc:offer", onOffer);
      socket.off("webrtc:answer", onAnswer);
      socket.off("webrtc:ice-candidate", onIceCandidate);
      socket.off("webrtc:ready", onReady);
      socket.off("chat:message", onChatMessage);
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
    resetPeerConnection,
  ]);

  // Total cleanup of WebRTC and media tracks on component unmount
  useEffect(() => {
    return () => {
      console.log("[room] cleaning up room session");
      closePeer();
      stopLocalStream();
    };
  }, [closePeer, stopLocalStream]);

  // Emit ready only when media is fully initialized and socket is connected
  useEffect(() => {
    if (!socket || !connected || !roomId || !mediaReady) return;

    console.log("[socket] emitting webrtc:ready", { roomId });
    socket.emit("webrtc:ready", { roomId });
  }, [socket, connected, roomId, mediaReady]);

  const toggleSelfAudio = async () => {
    try {
      const next = !selfAudioOn;
      await setLocalAudioEnabled(next);
      setSelfAudioOn(next);
      if (socket && roomId) {
        socket.emit("webrtc:media-toggle", { roomId, kind: "audio", enabled: next });
      }
    } catch (err) {
      console.log("[webrtc] toggle self audio failed", err?.message || err);
    }
  };

  const toggleSelfVideo = async () => {
    try {
      const next = !selfVideoOn;
      await setLocalVideoEnabled(next);
      setSelfVideoOn(next);
      if (socket && roomId) {
        socket.emit("webrtc:media-toggle", { roomId, kind: "video", enabled: next });
      }
    } catch (err) {
      console.log("[webrtc] toggle self video failed", err?.message || err);
    }
  };

  const handleToggleChat = () => {
    setShowChat((prev) => {
      const next = !prev;
      if (next) {
        setUnreadCount(0);
        setToastNotification(null);
      }
      return next;
    });
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
    <main className="roomContainer">
      <header className="roomHeader">
        <div className="roomTitleWrapper">
          <h1 className="roomTitle">WebRTC Conference</h1>
          <p className="roomSubtitle">
            Room: <code className="roomCode">{roomId}</code>
            {email ? <> • Connected as: <code className="emailCode">{email}</code></> : null}
          </p>
        </div>

        <div className="statusIndicatorsGroup">
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

      <section className="roomCard">
        {mediaError ? (
          <div className="mediaErrorBanner">
            <span>Media Error: <code>{mediaError}</code></span>
            <button onClick={retryMedia} className="mediaErrorResolveBtn">
              Resolve
            </button>
          </div>
        ) : null}

        <div className={`roomLayout ${showChat ? "withChat" : ""}`}>
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
              
              {remoteStream && 
               remoteStream.getVideoTracks().length > 0 && 
               remoteStream.getVideoTracks().some(t => t.readyState === "live") && 
               remoteVideoOn ? (
                <video
                  ref={remoteVideoRef}
                  className="videoFeed remoteVideoFeed"
                  autoPlay
                  playsInline
                />
              ) : remoteStream ? (
                <div className="placeholderOverlay remotePlaceholder">
                  <div className="avatarCircle remoteAvatar">
                    👤
                  </div>
                  <div className="placeholderText">Camera Turned Off</div>
                </div>
              ) : (
                <div className="placeholderOverlay remotePlaceholder">
                  <div className="avatarCircle remoteAvatar">
                    👤
                  </div>
                  <div className="placeholderText">
                    {peerConnectionState === "disconnected" || peerConnectionState === "failed" || peerConnectionState === "closed"
                      ? "Remote Peer Disconnected"
                      : "Waiting for Remote Video..."}
                  </div>
                </div>
              )}
            </div>
          </div>

          <aside className={`chatPanel ${showChat ? "open" : "closed"}`}>
            <header className="chatHeader">
              <span>Room Chat</span>
              <button 
                onClick={handleToggleChat} 
                className="chatCloseBtn"
                aria-label="Close Chat"
              >
                ✕
              </button>
            </header>
            <div className="chatMessages">
              {messages.map((msg, index) => (
                <div key={index} className={`chatMessage ${msg.self ? "self" : "other"}`}>
                  {!msg.self && <span className="messageSender">{(msg.sender || "Anonymous").split("@")[0]}</span>}
                  <span>{msg.message}</span>
                  <span className="messageTime">{msg.timestamp}</span>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <form className="chatInputForm" onSubmit={sendChatMessage}>
              <input
                type="text"
                className="chatInput"
                placeholder="Type a message..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                required
              />
              <button type="submit" className="chatSendBtn" disabled={!chatInput.trim()}>
                ➔
              </button>
            </form>
          </aside>
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

            <button
              type="button"
              onClick={handleToggleChat}
              className={`toolbarBtn ${showChat ? "active-blue" : "normal"}`}
              aria-label={showChat ? "Hide Chat" : "Show Chat"}
            >
              <span>💬</span>
              {unreadCount > 0 && (
                <span className="unreadBadge" />
              )}
              <span className="tooltip">{showChat ? "Hide Chat" : "Show Chat"}</span>
            </button>

            <div className="toolbarDivider" />

            <button
              type="button"
              onClick={handleExitCall}
              className="toolbarBtn danger disconnectBtn"
              aria-label="End Call"
            >
              <span>📞</span>
              <span className="tooltip">Disconnect</span>
            </button>
          </div>
        </div>
      </section>
      {toastNotification && (
        <div 
          className="chatToast" 
          onClick={handleToggleChat}
        >
          <div className="chatToastAvatar">
            {toastNotification.sender.charAt(0).toUpperCase()}
          </div>
          <div className="chatToastContent">
            <span className="chatToastSender">{toastNotification.sender}</span>
            <span className="chatToastBody">{toastNotification.message}</span>
          </div>
          <button 
            type="button"
            className="chatToastClose"
            onClick={(e) => {
              e.stopPropagation();
              setToastNotification(null);
            }}
          >
            ✕
          </button>
        </div>
      )}
    </main>
  );
}

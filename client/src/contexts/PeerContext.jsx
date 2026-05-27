import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const PeerContext = createContext(null);

function getDefaultIceServers() {
  // You can override by setting VITE_ICE_SERVERS to a JSON string, e.g.
  // [{"urls":["stun:stun.l.google.com:19302"]}]
  const raw = import.meta.env.VITE_ICE_SERVERS;
  if (!raw) return [{ urls: ["stun:stun.l.google.com:19302"] }];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [{ urls: ["stun:stun.l.google.com:19302"] }];
  } catch {
    return [{ urls: ["stun:stun.l.google.com:19302"] }];
  }
}

function hasLiveTrack(stream, kind) {
  return stream?.getTracks().some((track) => track.kind === kind && track.readyState === "live");
}

export function PeerProvider({ children }) {
  const peerRef = useRef(null);
  const videoSenderRef = useRef(null);
  const pendingIceCandidatesRef = useRef([]);
  const localStreamRef = useRef(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  const replaceLocalStream = useCallback((tracks) => {
    const nextStream = new MediaStream(tracks.filter(Boolean));
    setLocalStream(nextStream);
    localStreamRef.current = nextStream;
    return nextStream;
  }, []);

  const flushPendingIceCandidates = useCallback(async (peer) => {
    const candidates = pendingIceCandidatesRef.current;
    if (!candidates.length) return;
    pendingIceCandidatesRef.current = [];

    for (const candidate of candidates) {
      try {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // ignore
      }
    }
  }, []);

  const ensurePeer = useCallback(() => {
    if (peerRef.current) {
      const state = peerRef.current.signalingState;
      const connectionState = peerRef.current.connectionState;
      if (state !== "closed" && connectionState !== "closed") return peerRef.current;

      try {
        peerRef.current.close();
      } catch {
        // ignore
      }
      peerRef.current = null;
      videoSenderRef.current = null;
      pendingIceCandidatesRef.current = [];
    }

    const peer = new RTCPeerConnection({ iceServers: getDefaultIceServers() });
    peerRef.current = peer;

    peer.ontrack = (event) => {
      console.log("[webrtc] ontrack event received", event);
      const [remoteStreamFromEvent] = event.streams;
      if (remoteStreamFromEvent) {
        // Wrap tracks in a new MediaStream to ensure React detects reference change and triggers re-render
        setRemoteStream(new MediaStream(remoteStreamFromEvent.getTracks()));
      } else {
        // Fallback: manually aggregate tracks into a new MediaStream to trigger React re-renders.
        setRemoteStream((prev) => {
          const stream = prev && prev.constructor.name === "MediaStream" ? prev : new MediaStream();
          if (!stream.getTracks().some((t) => t.id === event.track.id)) {
            stream.addTrack(event.track);
          }
          return new MediaStream(stream.getTracks());
        });
      }
    };

    return peer;
  }, []);

  const initLocalStream = useCallback(async (constraints = { audio: true, video: true }) => {
    const peer = ensurePeer();
    const previousStream = localStreamRef.current;

    if (previousStream) {
      const hasRequiredAudio = !constraints.audio || hasLiveTrack(previousStream, "audio");
      const hasRequiredVideo = !constraints.video || hasLiveTrack(previousStream, "video");
      if (hasRequiredAudio && hasRequiredVideo) {
        return previousStream;
      }
    }

    const stream = await navigator.mediaDevices.getUserMedia(constraints);

    if (previousStream) {
      previousStream.getTracks().forEach((track) => track.stop());
    }

    setLocalStream(stream);
    localStreamRef.current = stream;
    // Add tracks immediately so offer/answer includes media even if state updates lag.
    const senders = peer.getSenders();
    const existing = new Set(senders.map((s) => s.track?.id).filter(Boolean));

    for (const sender of senders) {
      if (!sender.track) continue;
      if (sender.track.kind === "video" && !constraints.video) continue;
      if (sender.track.kind === "audio" && !constraints.audio) continue;
      try {
        await sender.replaceTrack(null);
      } catch {
        // ignore
      }
    }

    for (const track of stream.getTracks()) {
      if (existing.has(track.id)) continue;
      const matchingSender = senders.find((sender) => sender.track?.kind === track.kind);
      if (matchingSender) {
        try {
          await matchingSender.replaceTrack(track);
          if (track.kind === "video") videoSenderRef.current = matchingSender;
          continue;
        } catch {
          // ignore
        }
      }

      const sender = peer.addTrack(track, stream);
      if (track.kind === "video") videoSenderRef.current = sender;
    }

    if (!videoSenderRef.current) {
      videoSenderRef.current = peer.getSenders().find((s) => s.track?.kind === "video") ?? null;
    }
    return stream;
  }, [ensurePeer]);

  useEffect(() => {
    const peer = peerRef.current;
    if (!peer || !localStream) return;

    const existingSenders = new Set(peer.getSenders().map((s) => s.track?.id).filter(Boolean));
    for (const track of localStream.getTracks()) {
      if (existingSenders.has(track.id)) continue;
      peer.addTrack(track, localStream);
    }
  }, [localStream]);

  const createOffer = useCallback(async () => {
    const peer = ensurePeer();
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    return peer.localDescription;
  }, [ensurePeer]);

  const createAnswer = useCallback(async (offer) => {
    const peer = ensurePeer();
    await peer.setRemoteDescription(new RTCSessionDescription(offer));
    await flushPendingIceCandidates(peer);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    return peer.localDescription;
  }, [ensurePeer, flushPendingIceCandidates]);

  const setRemoteAnswer = useCallback(async (answer) => {
    const peer = ensurePeer();
    await peer.setRemoteDescription(new RTCSessionDescription(answer));
    await flushPendingIceCandidates(peer);
  }, [ensurePeer, flushPendingIceCandidates]);

  const addIceCandidate = useCallback(async (candidate) => {
    const peer = ensurePeer();
    if (!candidate) return;
    if (!peer.remoteDescription) {
      pendingIceCandidatesRef.current.push(candidate);
      return;
    }
    await peer.addIceCandidate(new RTCIceCandidate(candidate));
  }, [ensurePeer]);

  const closePeer = useCallback(() => {
    if (peerRef.current) {
      peerRef.current.ontrack = null;
      peerRef.current.onicecandidate = null;
      peerRef.current.close();
      peerRef.current = null;
    }

    videoSenderRef.current = null;
    pendingIceCandidatesRef.current = [];
    setRemoteStream(null);
  }, []);

  const stopLocalStream = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getTracks().forEach((t) => t.stop());
    setLocalStream(null);
    localStreamRef.current = null;
    videoSenderRef.current = null;
  }, []);

  const setLocalVideoEnabled = useCallback(
    async (enabled) => {
      const peer = ensurePeer();

      if (!enabled) {
        const stream = localStreamRef.current;
        if (!stream) return false;

        const activeVideoSenders = peer.getSenders().filter((s) => s.track?.kind === "video");
        for (const sender of activeVideoSenders) {
          videoSenderRef.current = sender;
          try {
            await sender.replaceTrack(null);
          } catch {
            // ignore
          }
        }

        const remainingTracks = stream.getAudioTracks();
        for (const track of stream.getVideoTracks()) {
          try {
            stream.removeTrack(track);
          } catch {
            // ignore
          }
          try {
            track.stop();
          } catch {
            // ignore
          }
        }

        replaceLocalStream(remainingTracks);
        return true;
      }

      // Enable video
      const stream = localStreamRef.current;
      if (!stream) {
        await initLocalStream({ audio: true, video: true });
        return true;
      }

      const existingLive = stream
        .getVideoTracks()
        .find((t) => t.readyState !== "ended" && t.enabled !== false);
      if (existingLive) {
        const sender =
          videoSenderRef.current ?? peer.getSenders().find((s) => s.track?.kind === "video") ?? null;
        if (sender) {
          videoSenderRef.current = sender;
          try {
            if (sender.track !== existingLive) await sender.replaceTrack(existingLive);
          } catch {
            // ignore
          }
        }
        return true;
      }

      const camStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      const [videoTrack] = camStream.getVideoTracks();
      if (!videoTrack) return false;

      const nextStream = replaceLocalStream([...stream.getAudioTracks(), videoTrack]);

      const sender =
        videoSenderRef.current ?? peer.getSenders().find((s) => s.track?.kind === "video") ?? null;
      if (sender) {
        videoSenderRef.current = sender;
        try {
          await sender.replaceTrack(videoTrack);
        } catch {
          // ignore
        }
      } else {
        videoSenderRef.current = peer.addTrack(videoTrack, nextStream);
      }

      return true;
    },
    [ensurePeer, initLocalStream, replaceLocalStream],
  );

  useEffect(() => {
    return () => {
      closePeer();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [closePeer]);

  const value = useMemo(
    () => ({
      peer: peerRef.current,
      ensurePeer,
      localStream,
      remoteStream,
      initLocalStream,
      createOffer,
      createAnswer,
      setRemoteAnswer,
      addIceCandidate,
      stopLocalStream,
      setLocalVideoEnabled,
      closePeer,
    }),
    [
      ensurePeer,
      localStream,
      remoteStream,
      initLocalStream,
      createOffer,
      createAnswer,
      setRemoteAnswer,
      addIceCandidate,
      stopLocalStream,
      setLocalVideoEnabled,
      closePeer,
    ],
  );

  return <PeerContext.Provider value={value}>{children}</PeerContext.Provider>;
}

export function usePeer() {
  const ctx = useContext(PeerContext);
  if (!ctx) throw new Error("usePeer must be used within <PeerProvider />");
  return ctx;
}

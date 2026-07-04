import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

const SocketContext = createContext(null);

export function SocketProvider({ children, url }) {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let serverUrl = url || import.meta.env.VITE_SIGNALING_URL || "http://localhost:8000";

    // Automatically resolve localhost to the current hostname when testing on a mobile/external device
    if (serverUrl.includes("localhost") && window.location.hostname !== "localhost") {
      serverUrl = serverUrl.replace("localhost", window.location.hostname);
    }

    console.log("[socket] connecting to", serverUrl);
    const socketInstance = io(serverUrl, {
      autoConnect: true,
    });

    setSocket(socketInstance);

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onConnectError = (err) => console.log("[socket] connect_error", err?.message || err);

    socketInstance.on("connect", onConnect);
    socketInstance.on("disconnect", onDisconnect);
    socketInstance.on("connect_error", onConnectError);

    return () => {
      socketInstance.off("connect", onConnect);
      socketInstance.off("disconnect", onDisconnect);
      socketInstance.off("connect_error", onConnectError);
      socketInstance.disconnect();
      setSocket(null);
    };
  }, [url]);

  const value = useMemo(
    () => ({
      socket,
      connected,
    }),
    [socket, connected],
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error("useSocket must be used within <SocketProvider />");
  return ctx;
}

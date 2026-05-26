import Home from "./Pages/Home.jsx";
import Room from "./Pages/Room.jsx";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";

export default function App() {
  const navigate = useNavigate();

  return (
    <Routes>
      <Route
        path="/"
        element={
          <Home
            onJoin={({ email, roomId }) => {
              const next = `/room/${encodeURIComponent(
                roomId,
              )}?email=${encodeURIComponent(email)}`;
              navigate(next);
            }}
          />
        }
      />
      <Route path="/room/:roomId" element={<Room />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

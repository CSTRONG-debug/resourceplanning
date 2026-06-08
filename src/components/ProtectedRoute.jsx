import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children, requireRole }) {
  const { session, role, loading } = useAuth();

  if (loading) return <div style={{ padding: "2rem" }}>Loading…</div>;

  if (!session) return <Navigate to="/login" replace />;

  // Optional role gate. admin satisfies any requirement.
  if (requireRole) {
    const ok =
      role === "admin" ||
      role === requireRole ||
      (requireRole === "manager" && role === "manager");
    if (!ok) return <Navigate to="/" replace />;
  }

  return children;
}

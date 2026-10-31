import { Toaster } from "@/components/ui/toaster"
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import ScrollToTop from './components/ScrollToTop';
import { AuthProvider } from '@/lib/AuthContext';
import Home from './pages/Home';

if (typeof window !== "undefined") {
  fetch(`${import.meta.env.VITE_API_URL ?? "https://essentialsedm.com/api"}/site/visit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: window.location.pathname }),
  }).catch(() => {});
}
import Login from './pages/Login';
import Register from './pages/Register';
import Join from './pages/Join';
import AuthCallback from './pages/AuthCallback';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Privacy from './pages/Privacy';

/**
 * ESSENTIALS public site — marketing front page.
 * Served at essentialsedm.com. Auth-gated app lives in apps/web (dashboard)
 * and the mobile app; this page is public.
 */
const PublicSite = () => (
  <>
    <ScrollToTop />
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/join" element={<Join />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="*" element={<Home />} />
    </Routes>
    <Toaster />
  </>
);

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <PublicSite />
      </AuthProvider>
    </Router>
  );
}

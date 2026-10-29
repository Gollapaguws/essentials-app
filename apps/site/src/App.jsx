import { Toaster } from "@/components/ui/toaster"
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import ScrollToTop from './components/ScrollToTop';
import Home from './pages/Home';
import Login from './pages/Login';
import AuthVerify from './pages/AuthVerify';

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
      <Route path="/auth/verify" element={<AuthVerify />} />
      <Route path="*" element={<Home />} />
    </Routes>
    <Toaster />
  </>
);

export default function App() {
  return (
    <Router>
      <PublicSite />
    </Router>
  );
}

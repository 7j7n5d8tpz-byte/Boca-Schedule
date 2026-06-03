import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import PlayerDashboard from './pages/player/Dashboard';
import CoachDashboard from './pages/coach/Dashboard';
import MatchDetail from './pages/coach/MatchDetail';
import Selections from './pages/coach/Selections';
import NewMatch from './pages/coach/NewMatch';
import PlayerProfile from './pages/player/Profile';
import Statistics from './pages/player/Statistics';
import MatchResults from './pages/MatchResults';
import AdminDashboard from './pages/admin/Dashboard';
import BatchOptimize from './pages/coach/BatchOptimize';
import HistoricalMatch from './pages/coach/HistoricalMatch';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function RoleRouter() {
  const { user, isAuthenticated } = useAuth();

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  if (user?.role === 'admin') return <Navigate to="/admin" replace />;
  if (user?.role === 'coach') return <Navigate to="/coach" replace />;
  return <Navigate to="/dashboard" replace />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/dashboard" element={<ProtectedRoute roles={['player', 'coach', 'admin']}><PlayerDashboard /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute roles={['player', 'coach', 'admin']}><PlayerProfile /></ProtectedRoute>} />
            <Route path="/statistics" element={<ProtectedRoute roles={['player', 'coach', 'admin']}><Statistics /></ProtectedRoute>} />
            <Route path="/matches/:matchId/results" element={<ProtectedRoute roles={['player', 'coach', 'admin']}><MatchResults /></ProtectedRoute>} />
            <Route path="/coach" element={<ProtectedRoute roles={['coach', 'admin']}><CoachDashboard /></ProtectedRoute>} />
            <Route path="/coach/matches/new" element={<ProtectedRoute roles={['coach', 'admin']}><NewMatch /></ProtectedRoute>} />
            <Route path="/coach/historical" element={<ProtectedRoute roles={['coach', 'admin']}><HistoricalMatch /></ProtectedRoute>} />
            <Route path="/coach/matches/:matchId" element={<ProtectedRoute roles={['coach', 'admin']}><MatchDetail /></ProtectedRoute>} />
            <Route path="/coach/matches/:matchId/selections" element={<ProtectedRoute roles={['coach', 'admin']}><Selections /></ProtectedRoute>} />
            <Route path="/coach/optimize" element={<ProtectedRoute roles={['coach', 'admin']}><BatchOptimize /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute roles={['admin']}><AdminDashboard /></ProtectedRoute>} />
            <Route path="/" element={<RoleRouter />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function ProtectedRoute({ children, roles }: { children: React.ReactNode; roles: string[] }) {
  const { user, isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!roles.includes(user?.role ?? '')) return <Navigate to="/" replace />;
  return <>{children}</>;
}

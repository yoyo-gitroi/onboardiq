import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import NewCandidate from './pages/NewCandidate';
import CandidateDetails from './pages/CandidateDetails';
import { LogOut } from 'lucide-react';
import { logout } from './firebase';
import { ErrorBoundary } from './components/ErrorBoundary';

const PrivateRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center">Loading...</div>;
  return user ? <>{children}</> : <Navigate to="/login" />;
};

const Layout = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold text-indigo-600">OnboardIQ</h1>
        {user && (
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-600">{user.email}</span>
            <button onClick={logout} className="p-2 text-slate-500 hover:text-slate-900 rounded-full hover:bg-slate-100 transition-colors">
              <LogOut size={20} />
            </button>
          </div>
        )}
      </header>
      <main className="max-w-7xl mx-auto p-6">
        {children}
      </main>
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Router>
          <Layout>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
              <Route path="/new" element={<PrivateRoute><NewCandidate /></PrivateRoute>} />
              <Route path="/candidate/:id" element={<PrivateRoute><CandidateDetails /></PrivateRoute>} />
            </Routes>
          </Layout>
        </Router>
      </AuthProvider>
    </ErrorBoundary>
  );
}

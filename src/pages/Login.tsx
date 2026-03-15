import React from 'react';
import { useAuth } from '../AuthContext';
import { loginWithGoogle } from '../firebase';
import { Navigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';

export default function Login() {
  const { user, loading } = useAuth();

  if (loading) return <div className="flex h-screen items-center justify-center">Loading...</div>;
  if (user) return <Navigate to="/" />;

  return (
    <div className="flex flex-col items-center justify-center h-[80vh]">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 max-w-md w-full text-center">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">OnboardIQ</h1>
        <p className="text-slate-500 mb-8">AI-Powered HR Onboarding Document Intelligence Agent</p>
        <button
          onClick={loginWithGoogle}
          className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 px-4 rounded-xl transition-colors"
        >
          <LogIn size={20} />
          Sign in with Google
        </button>
      </div>
    </div>
  );
}

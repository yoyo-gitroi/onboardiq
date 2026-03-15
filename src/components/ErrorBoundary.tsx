import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let errorMessage = this.state.error?.message || 'An unexpected error occurred.';
      let errorDetails = '';

      try {
        const parsed = JSON.parse(errorMessage);
        if (parsed.error) {
          errorMessage = parsed.error;
          errorDetails = JSON.stringify(parsed, null, 2);
        }
      } catch (e) {
        // Not JSON
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-rose-200 max-w-2xl w-full">
            <div className="flex items-center gap-3 text-rose-600 mb-4">
              <AlertTriangle size={32} />
              <h1 className="text-2xl font-bold">Something went wrong</h1>
            </div>
            <p className="text-slate-700 mb-4">
              The application encountered an error. Please try refreshing the page or contact support if the problem persists.
            </p>
            <div className="bg-rose-50 p-4 rounded-xl border border-rose-100 overflow-auto">
              <p className="font-mono text-sm text-rose-800 font-semibold mb-2">{errorMessage}</p>
              {errorDetails && (
                <pre className="font-mono text-xs text-rose-700 whitespace-pre-wrap">
                  {errorDetails}
                </pre>
              )}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="mt-6 bg-rose-600 hover:bg-rose-700 text-white font-medium py-2 px-6 rounded-xl transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

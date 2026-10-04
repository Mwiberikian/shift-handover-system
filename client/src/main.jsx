import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from './auth/AuthContext';
import { ThemeProvider, useTheme } from './theme/ThemeContext';
import App from './App';
import './index.css';

// Toasts follow the app theme.
function ThemedToaster() {
  const { theme } = useTheme();
  return (
    <Toaster
      theme={theme}
      position="top-right"
      offset={{ top: 100, right: 16 }}
      mobileOffset={{ top: 96 }}
      closeButton
      toastOptions={{
        // Sonner's own CSS is unlayered, so these need `!` to win.
        classNames: {
          toast: 'font-sans! rounded-xl! border-ink-200! bg-surface! shadow-pop!',
          title: 'text-fg! font-semibold!',
          description: 'text-ink-600! whitespace-pre-line',
          success: '[&_[data-icon]]:text-status-green',
          info: '[&_[data-icon]]:text-status-blue',
          warning: '[&_[data-icon]]:text-status-amber',
          error: 'border-l-4! border-l-status-red! [&_[data-icon]]:text-status-red [&_[data-title]]:text-status-red!',
        },
      }}
    />
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
        <ThemedToaster />
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
);

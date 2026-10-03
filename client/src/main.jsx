import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from './auth/AuthContext';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
      <Toaster
        position="top-right"
        offset={{ top: 68, right: 16 }}
        mobileOffset={{ top: 64 }}
        closeButton
        toastOptions={{
          // Sonner's own CSS is unlayered, so these need `!` to win.
          classNames: {
            toast: 'font-sans! rounded-xl! border-zinc-200! shadow-pop!',
            title: 'text-brand-black! font-semibold!',
            description: 'text-zinc-600! whitespace-pre-line',
            success: '[&_[data-icon]]:text-status-green',
            info: '[&_[data-icon]]:text-status-blue',
            warning: '[&_[data-icon]]:text-status-amber',
            error: 'border-l-4! border-l-status-red! [&_[data-icon]]:text-status-red [&_[data-title]]:text-status-red!',
          },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>,
);

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
        richColors
        closeButton
        toastOptions={{ style: { fontFamily: 'var(--font-sans)' }, classNames: { description: 'whitespace-pre-line' } }}
      />
    </BrowserRouter>
  </React.StrictMode>,
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { AppProvider, createApi, useApp } from './app';
import { BottomNav } from './ui/parts';
import Login from './screens/Login';
import Today from './screens/Today';
import History from './screens/History';
import DailyLog from './screens/DailyLog';
import Queue from './screens/Queue';
import Farm from './screens/Farm';
import Settings from './screens/Settings';
import './styles.css';

registerSW({ immediate: true });

function Shell() {
  const { session } = useApp();
  if (!session) {
    return <Routes><Route path="/login" element={<Login />} /><Route path="*" element={<Navigate to="/login" replace />} /></Routes>;
  }
  const head = session.role === 'head';
  return (
    <div className={`shell${head ? ' wide' : ''}`}>
      <BottomNav />
      <div className="main">
        <Routes>
          <Route path="/today" element={<Today />} />
          <Route path="/history" element={<History />} />
          <Route path="/log/:hb/:day" element={<DailyLog />} />
          <Route path="/queue" element={<Queue />} />
          {head && <Route path="/farm" element={<Farm />} />}
          {head && <Route path="/settings" element={<Settings />} />}
          <Route path="*" element={<Navigate to={head ? '/farm' : '/today'} replace />} />
        </Routes>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider api={createApi()}>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}><Shell /></BrowserRouter>
    </AppProvider>
  </StrictMode>,
);

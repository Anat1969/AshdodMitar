import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { StoreProvider } from './lib/store';
import TopBar from './components/TopBar';
import Home from './pages/Home';
import MapPage from './pages/MapPage';
import DistrictPage from './pages/District';
import PlanPage from './pages/Plan';
import RulesPage from './pages/Rules';
import RegisterPage from './pages/Register';
import ReportPage from './pages/Report';
import DocumentsPage from './pages/Documents';
import AboutPage from './pages/About';
import './styles.css';

function App() {
  return (
    <div className="app">
      <TopBar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/district/:id" element={<DistrictPage />} />
        <Route path="/plan/:id" element={<PlanPage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/rules" element={<RulesPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/report/:year" element={<ReportPage />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <StoreProvider>
          <App />
        </StoreProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

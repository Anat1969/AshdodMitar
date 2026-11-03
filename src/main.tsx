import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
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
import LedgerPage from './pages/Ledger';
import PlansPage from './pages/Plans';
import PlanFilePage from './pages/PlanFile';
import TargetsPage from './pages/Targets';
import StartPage from './pages/Start';
import PlansMapPage from './pages/PlansMap';
import PlanViewPage from './pages/PlanView';
import AddPlanPage from './pages/AddPlan';
import ComparePage from './pages/Compare';
import ToolsPage from './pages/Tools';
import Peek from './components/Peek';
import './styles.css';

function CheckRedirect() { const { id } = useParams(); return <Navigate to={`/tools/check/${id}`} replace />; }

function App() {
  return (
    <div className="app">
      <TopBar />
      <Routes>
        {/* main flow: five pages */}
        <Route path="/" element={<StartPage />} />
        <Route path="/map" element={<PlansMapPage />} />
        <Route path="/plan/:num" element={<PlanViewPage />} />
        <Route path="/add" element={<AddPlanPage />} />
        <Route path="/compare" element={<ComparePage />} />
        {/* more tools: every earlier page, kept */}
        <Route path="/tools" element={<ToolsPage />} />
        <Route path="/tools/layers" element={<MapPage />} />
        <Route path="/tools/check/:id" element={<PlanPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/overview" element={<Home />} />
        <Route path="/ledger" element={<LedgerPage />} />
        <Route path="/plans" element={<PlansPage />} />
        <Route path="/plans/:id" element={<PlanFilePage />} />
        <Route path="/targets" element={<TargetsPage />} />
        <Route path="/district/:id" element={<DistrictPage />} />
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/rules" element={<RulesPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/report/:year" element={<ReportPage />} />
        <Route path="/check/:id" element={<CheckRedirect />} />
        <Route path="*" element={<StartPage />} />
      </Routes>
      <Peek />
    </div>
  );
}

// the GitHub build (app/, served from a deep path on raw.githack) uses hash routing; Vercel keeps clean paths
const Router = import.meta.env.VITE_HASH_ROUTER === '1' ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router>
      <AuthProvider>
        <StoreProvider>
          <App />
        </StoreProvider>
      </AuthProvider>
    </Router>
  </React.StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD && import.meta.env.VITE_HASH_ROUTER !== '1') {
  window.addEventListener('load', () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}));
}

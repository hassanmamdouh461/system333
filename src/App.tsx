import { HashRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { LanguageProvider } from './context/LanguageContext';

import { DashboardLayout } from './components/layout/DashboardLayout';
import Dashboard from './pages/Dashboard';
import Menu from './pages/Menu';
import Orders from './pages/Orders';
import Payment from './pages/Payment';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Login from './pages/Login';
import PublicMenu from './pages/PublicMenu';
import Inventory from './pages/Inventory';


function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  // DataProvider lives here so data is only fetched after the user is authenticated
  return (
    <DataProvider>
      <Outlet />
    </DataProvider>
  );
}

function isMenuDomain() {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  return host.startsWith('menu.') || host.includes('menu');
}

function DefaultRoute() {
  const { isAuthenticated } = useAuth();
  if (isMenuDomain()) return <Navigate to="/public-menu" replace />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Navigate to="/orders" replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/public-menu" element={<PublicMenu />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/menu" element={<Menu />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/payment" element={<Payment />} />
          <Route path="/inventory" element={<Inventory />} />
          
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Route>
      <Route path="/" element={<DefaultRoute />} />
      <Route path="*" element={<DefaultRoute />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <LanguageProvider>
        <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AppRoutes />
        </Router>
      </LanguageProvider>
    </AuthProvider>
  );
}

export default App;

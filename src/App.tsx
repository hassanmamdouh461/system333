import React, { useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { LoadingScreen } from './components/ui/LoadingScreen';
import { LanguageProvider } from './context/LanguageContext';

import { DashboardLayout } from './components/layout/DashboardLayout';
import Dashboard from './pages/Dashboard';
import Menu from './pages/Menu';
import Orders from './pages/Orders';
import Payment from './pages/Payment';
import Reports from './pages/Reports';
import ManagerDashboard from './pages/ManagerDashboard';
import Settings from './pages/Settings';
import Login from './pages/Login';
import PublicMenu from './pages/PublicMenu';
import Customers from './pages/Customers';
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

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/public-menu" element={<PublicMenu />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/menu" element={<Menu />} />
          <Route path="/orders" element={<Orders type="all" />} />
          <Route path="/kitchen" element={<Orders type="kitchen" />} />
          <Route path="/drinks" element={<Orders type="drinks" />} />
          <Route path="/payment" element={<Payment />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/inventory" element={<Inventory />} />
          
          <Route path="/reports" element={<Reports />} />
          <Route path="/manager-dashboard" element={<ManagerDashboard />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Route>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

function App() {
  const [showIntro, setShowIntro] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShowIntro(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  if (showIntro) {
    return <LoadingScreen />;
  }

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

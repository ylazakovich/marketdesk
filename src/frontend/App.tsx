import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Provider } from 'react-redux';
import { store } from './state/store.js';
import { AppThemeProvider } from './theme/ThemeProvider.js';
import { AppShell } from './components/layout/AppShell.js';
import { AuthBootstrap } from './components/AuthBootstrap.js';
import { Toast } from './components/common/Toast.js';
import { PageSkeleton } from './components/common/Skeleton.js';
import { useAppSelector } from './state/hooks.js';

// Pages are lazy-loaded so routing works end-to-end. These are stubs today;
// Group 9 replaces the page bodies.
const DashboardPage = lazy(() => import('./pages/DashboardPage.js'));
const ProductsPage = lazy(() => import('./pages/ProductsPage.js'));
const ListingDetailsPage = lazy(() => import('./pages/ListingDetailsPage.js'));
const ListingsPage = lazy(() => import('./pages/ListingsPage.js'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage.js'));
const HermesActivityPage = lazy(() => import('./pages/HermesActivityPage.js'));
const MarketplacesPage = lazy(() => import('./pages/MarketplacesPage.js'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.js'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.js'));
const LoginPage = lazy(() => import('./pages/LoginPage.js'));

// Guards the AppShell subtree: redirects unauthenticated users to /login.
const RequireAuth: React.FC = () => {
  const isAuthenticated = useAppSelector((s) => s.auth.isAuthenticated);
  return isAuthenticated ? <Outlet /> : <Navigate to="/login" replace />;
};

export const App: React.FC = () => (
  <Provider store={store}>
    <AppThemeProvider>
      <BrowserRouter>
        <AuthBootstrap>
          <Routes>
            <Route
              path="/login"
              element={
                <Suspense fallback={<PageSkeleton />}>
                  <LoginPage />
                </Suspense>
              }
            />
            <Route element={<RequireAuth />}>
              <Route element={<AppShell />}>
                <Route index element={<DashboardPage />} />
                <Route path="products" element={<ProductsPage />} />
                <Route path="products/:productId" element={<ListingDetailsPage />} />
                <Route path="listings" element={<ListingsPage />} />
                <Route path="analytics" element={<AnalyticsPage />} />
                <Route path="hermes" element={<HermesActivityPage />} />
                <Route path="marketplaces" element={<MarketplacesPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Route>
          </Routes>
        </AuthBootstrap>
        <Toast />
      </BrowserRouter>
    </AppThemeProvider>
  </Provider>
);

export default App;

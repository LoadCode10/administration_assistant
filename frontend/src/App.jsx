import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import Layout from './components/layout/Layout'
import ProtectedRoute from './routes/ProtectedRoute'
import AdminRoute from './routes/AdminRoute'
import HomeRoute from './routes/HomeRoute'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import HistoryPage from './pages/HistoryPage'
import HistoryDetailPage from './pages/HistoryDetailPage'
import AdminProceduresPage from './pages/admin/AdminProceduresPage'
import AdminProcedureFormPage from './pages/admin/AdminProcedureFormPage'
import AdminExtractPage from './pages/admin/AdminExtractPage'
import AdminExtractReviewPage from './pages/admin/AdminExtractReviewPage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<HomeRoute />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            <Route element={<ProtectedRoute />}>
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/history/:id" element={<HistoryDetailPage />} />
            </Route>

            <Route element={<AdminRoute />}>
              <Route path="/admin/procedures" element={<AdminProceduresPage />} />
              <Route path="/admin/procedures/new" element={<AdminProcedureFormPage />} />
              <Route path="/admin/procedures/:id/edit" element={<AdminProcedureFormPage />} />
              <Route path="/admin/extract" element={<AdminExtractPage />} />
              <Route path="/admin/extract/:id" element={<AdminExtractReviewPage />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

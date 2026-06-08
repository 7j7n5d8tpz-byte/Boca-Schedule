import { Navigate } from 'react-router-dom';
import AppNav from '../../components/AppNav';
import { useAuth } from '../../context/AuthContext';
import { ManageFines } from './FinesView';

export default function ManageFinesPage() {
  const { user } = useAuth();
  const isFineAdmin = user?.role === 'admin' || !!user?.isFineAdmin;

  if (!isFineAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen bg-gray-50 boca-page">
      <AppNav backHref="/fines" backLabel="← Fines" />
      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <h1 className="text-2xl font-extrabold text-gray-900 title-stripe">Manage fines</h1>
        <ManageFines />
      </main>
    </div>
  );
}

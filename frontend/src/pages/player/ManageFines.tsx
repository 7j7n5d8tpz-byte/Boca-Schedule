import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AppNav from '../../components/AppNav';
import { useAuth } from '../../context/AuthContext';
import { ManageFines } from './FinesView';

export default function ManageFinesPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const isFineAdmin = user?.role === 'admin' || !!user?.isFineAdmin;

  if (!isFineAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen bg-gray-50 boca-page">
      <AppNav backHref="/fines" backLabel={t('nav.fines')} />
      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <h1 className="text-2xl font-extrabold text-gray-900">{t('fines.manageTitle')}</h1>
        <ManageFines />
      </main>
    </div>
  );
}

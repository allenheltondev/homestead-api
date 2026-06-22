import { lazy, Suspense, type ReactElement } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import App from './App';
import ProtectedRoute from './auth/ProtectedRoute';
import RouteFallback from './components/RouteFallback';
import SignIn from './routes/SignIn';
import SignUp from './routes/SignUp';
import ForgotPassword from './routes/ForgotPassword';

// Routed pages are split into per-route chunks so the initial bundle only
// carries the app shell + auth pages. Each page (and its heavy deps, e.g.
// recharts) is fetched on first navigation. The auth screens stay eager
// because they gate everything else and load before the protected shell.
const Home = lazy(() => import('./routes/Home'));
const Animals = lazy(() => import('./routes/Animals'));
const AnimalDetail = lazy(() => import('./routes/AnimalDetail'));
const AnimalNew = lazy(() => import('./routes/AnimalNew'));
const Pastures = lazy(() => import('./routes/Pastures'));
const PastureDetail = lazy(() => import('./routes/PastureDetail'));
const Feed = lazy(() => import('./routes/Feed'));
const Eggs = lazy(() => import('./routes/Eggs'));
const Health = lazy(() => import('./routes/Health'));
const Milk = lazy(() => import('./routes/Milk'));
const Hatchery = lazy(() => import('./routes/Hatchery'));
const Care = lazy(() => import('./routes/Care'));
const Pnl = lazy(() => import('./routes/Pnl'));
const Garden = lazy(() => import('./routes/Garden'));
const Beds = lazy(() => import('./routes/Beds'));
const GoodRoots = lazy(() => import('./routes/GoodRoots'));
const Copilot = lazy(() => import('./routes/Copilot'));

// Wraps a lazily-loaded page in the shared route-level Suspense fallback so
// every navigation shows the same spinner while the chunk resolves.
function lazyRoute(element: ReactElement): ReactElement {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>;
}

export const router = createBrowserRouter([
  {
    path: '/signin',
    element: <SignIn />,
  },
  {
    path: '/signup',
    element: <SignUp />,
  },
  {
    path: '/forgot-password',
    element: <ForgotPassword />,
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <App />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: lazyRoute(<Home />) },
      { path: 'animals', element: lazyRoute(<Animals />) },
      { path: 'animals/new', element: lazyRoute(<AnimalNew />) },
      { path: 'animals/:animalId', element: lazyRoute(<AnimalDetail />) },
      { path: 'pastures', element: lazyRoute(<Pastures />) },
      { path: 'pastures/:pastureId', element: lazyRoute(<PastureDetail />) },
      { path: 'feed', element: lazyRoute(<Feed />) },
      { path: 'eggs', element: lazyRoute(<Eggs />) },
      { path: 'milk', element: lazyRoute(<Milk />) },
      { path: 'hatchery', element: lazyRoute(<Hatchery />) },
      { path: 'care', element: lazyRoute(<Care />) },
      { path: 'health', element: lazyRoute(<Health />) },
      { path: 'garden', element: lazyRoute(<Garden />) },
      { path: 'beds', element: lazyRoute(<Beds />) },
      { path: 'good-roots', element: lazyRoute(<GoodRoots />) },
      { path: 'pnl', element: lazyRoute(<Pnl />) },
      { path: 'copilot', element: lazyRoute(<Copilot />) },
    ],
  },
]);

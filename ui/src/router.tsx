import { createBrowserRouter } from 'react-router-dom';
import App from './App';
import ProtectedRoute from './auth/ProtectedRoute';
import Home from './routes/Home';
import SignIn from './routes/SignIn';
import SignUp from './routes/SignUp';
import ForgotPassword from './routes/ForgotPassword';
import Animals from './routes/Animals';
import AnimalDetail from './routes/AnimalDetail';
import AnimalNew from './routes/AnimalNew';
import Pastures from './routes/Pastures';
import PastureDetail from './routes/PastureDetail';
import Feed from './routes/Feed';
import Eggs from './routes/Eggs';
import Health from './routes/Health';
import Milk from './routes/Milk';
import Hatchery from './routes/Hatchery';
import Care from './routes/Care';
import Pnl from './routes/Pnl';
import Garden from './routes/Garden';
import Beds from './routes/Beds';
import GoodRoots from './routes/GoodRoots';
import Copilot from './routes/Copilot';

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
      { index: true, element: <Home /> },
      { path: 'animals', element: <Animals /> },
      { path: 'animals/new', element: <AnimalNew /> },
      { path: 'animals/:animalId', element: <AnimalDetail /> },
      { path: 'pastures', element: <Pastures /> },
      { path: 'pastures/:pastureId', element: <PastureDetail /> },
      { path: 'feed', element: <Feed /> },
      { path: 'eggs', element: <Eggs /> },
      { path: 'milk', element: <Milk /> },
      { path: 'hatchery', element: <Hatchery /> },
      { path: 'care', element: <Care /> },
      { path: 'health', element: <Health /> },
      { path: 'garden', element: <Garden /> },
      { path: 'beds', element: <Beds /> },
      { path: 'good-roots', element: <GoodRoots /> },
      { path: 'pnl', element: <Pnl /> },
      { path: 'copilot', element: <Copilot /> },
    ],
  },
]);

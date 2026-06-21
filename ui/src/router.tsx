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
    ],
  },
]);

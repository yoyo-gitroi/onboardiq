import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import { auth, db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from './utils/errorHandling';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  role: 'admin' | 'hr' | null;
}

const AuthContext = createContext<AuthContextType>({ user: null, loading: true, role: null });

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<'admin' | 'hr' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setLoading(true);
        try {
          const userRef = doc(db, 'users', currentUser.uid);
          const userSnap = await getDoc(userRef);
          if (userSnap.exists()) {
            setRole(userSnap.data().role);
          } else {
            const newRole = currentUser.email === 'yash.vats@agentic.it' ? 'admin' : 'hr';
            await setDoc(userRef, {
              name: currentUser.displayName || 'Unknown',
              email: currentUser.email,
              role: newRole,
              createdAt: new Date()
            });
            setRole(newRole);
          }
          setUser(currentUser);
        } catch (err) {
          try {
            handleFirestoreError(err, OperationType.WRITE, `users/${currentUser.uid}`);
          } catch (handledErr) {
            setError(handledErr as Error);
          }
        } finally {
          setLoading(false);
        }
      } else {
        setUser(null);
        setRole(null);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  if (error) throw error;

  return (
    <AuthContext.Provider value={{ user, loading, role }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

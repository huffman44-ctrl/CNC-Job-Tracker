/**
 * Thin wrapper around Firebase Authentication (Email/Password provider).
 * No DOM knowledge - app.js owns all screen/UI wiring. Errors are passed
 * through as Firebase throws them (real .message text like "The password
 * is invalid...") rather than mapped to custom copy - see the design
 * spec's Error handling section for why.
 */
const Auth = (() => {
  function signIn(email, password) {
    return firebase.auth().signInWithEmailAndPassword(email, password);
  }

  function signOut() {
    return firebase.auth().signOut();
  }

  function onAuthChange(callback) {
    firebase.auth().onAuthStateChanged(callback);
  }

  return { signIn, signOut, onAuthChange };
})();

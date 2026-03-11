// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-analytics.js";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries
// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyD03d2hAVIZiwDcrDwtItsPryIFgfPRptk",
  authDomain: "eclyrics-e8d68.firebaseapp.com",
  projectId: "eclyrics-e8d68",
  storageBucket: "eclyrics-e8d68.firebasestorage.app",
  messagingSenderId: "915140658388",
  appId: "1:915140658388:web:f93f38ee65aa9ed956e741",
  measurementId: "G-31H9DKTNPB"
};
// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
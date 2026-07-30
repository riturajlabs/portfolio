import Navbar from "./components/layout/Navbar";
import Footer from "./components/layout/Footer";
import ScrollToTop from "./components/common/ScrollToTop";

import Home from "./pages/Home";

import ChatAssistant from "./components/common/ChatAssistant";

function App() {

    return (

        <>

            <ScrollToTop />

            <Navbar />

            <main>

                <Home />

            </main>

            <Footer />

            <ChatAssistant />

        </>

    );

}

export default App;
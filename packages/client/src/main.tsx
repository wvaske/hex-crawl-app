import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import './index.css';
import { Landing } from './views/Landing.js';
import { CampaignGate } from './views/CampaignGate.js';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/c/:campaignId" element={<CampaignGate />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);

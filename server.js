const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Supabase configuration
const supabaseUrl = 'https://pgcihdudakccdpkzglqy.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBnY2loZHVkYWtjY2Rwa3pnbHF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzYxNDQ4NzMsImV4cCI6MjA1MTcyMDg3M30.8K8v8K8v8K8v8K8v8K8v8K8v8K8v8K8v8K8v8K8v8K8';
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Clubkonnect API credentials
const CLUBKONNECT_USER_ID = 'CK101263986';
const CLUBKONNECT_API_KEY = 'ZH43G14H2O112KEEO1KF1ZCU69V52FU75008OBP31OGM5RZJN7E713042K5I52IB';
const CLUBKONNECT_URL = 'https://www.clubkonnect.com/APIParaGetAirTimeV1.asp';

// Proxy endpoint for airtime purchase
app.post('/airtime-purchase', async (req, res) => {
  try {
    const { phoneNumber, amount, network, userId } = req.body;

    console.log('🟡 Proxy: Starting airtime purchase');
    console.log('🟡 Phone:', phoneNumber, 'Amount:', amount, 'Network:', network, 'User:', userId);

    // Validate required fields
    if (!phoneNumber || !amount || !network || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: phoneNumber, amount, network, userId'
      });
    }

    // Check user balance first
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('balance')
      .eq('id', userId)
      .single();

    if (userError) {
      console.error('❌ Proxy: User fetch error:', userError);
      return res.status(400).json({
        success: false,
        message: 'User not found',
        error: 'USER_NOT_FOUND'
      });
    }

    const currentBalance = userData.balance || 0;
    if (currentBalance < amount) {
      console.log('❌ Proxy: Insufficient balance:', currentBalance, '<', amount);
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. You have ₦${currentBalance.toFixed(2)}`,
        error: 'INSUFFICIENT_BALANCE'
      });
    }

    // Prepare the request to Clubkonnect
    const requestBody = new URLSearchParams({
      UserID: CLUBKONNECT_USER_ID,
      APIKey: CLUBKONNECT_API_KEY,
      PhoneNumber: phoneNumber,
      Amount: amount.toString(),
      Network: network,
    });

    console.log('🟡 Proxy: Request body:', requestBody.toString());

    // Make the API call to Clubkonnect
    const clubkonnectResponse = await fetch(CLUBKONNECT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'SubbigApp/1.0',
      },
      body: requestBody,
    });

    console.log('🟡 Proxy: Response status:', clubkonnectResponse.status);
    
    const responseText = await clubkonnectResponse.text();
    console.log('🟡 Proxy: Response body:', responseText);

    if (clubkonnectResponse.status === 200) {
      // Parse the response
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch (e) {
        // If not JSON, treat as text response
        responseData = {
          success: true,
          message: responseText,
          transactionId: extractTransactionId(responseText),
        };
      }

      if (responseData.success !== false) {
        console.log('✅ Proxy: Airtime purchase successful');
        
        // Update user balance
        const newBalance = currentBalance - amount;
        const { error: balanceError } = await supabase
          .from('users')
          .update({ balance: newBalance })
          .eq('id', userId);

        if (balanceError) {
          console.error('❌ Proxy: Balance update error:', balanceError);
        } else {
          console.log('✅ Proxy: Balance updated successfully');
        }

        // Record transaction
        const { error: transactionError } = await supabase
          .from('transactions')
          .insert({
            user_id: userId,
            amount: amount,
            type: 'airtime_purchase',
            status: 'completed',
            description: `Airtime purchase for ${phoneNumber}`,
            reference: `AIR_${Date.now()}`,
          });

        if (transactionError) {
          console.error('❌ Proxy: Transaction record error:', transactionError);
        } else {
          console.log('✅ Proxy: Transaction recorded successfully');
        }

        return res.json({
          success: true,
          message: responseData.message || 'Airtime purchased successfully',
          transactionId: responseData.transactionId,
          amount: amount,
          phoneNumber: phoneNumber,
          network: network,
          newBalance: newBalance,
        });
      } else {
        console.log('❌ Proxy: Airtime purchase failed:', responseData.message);
        return res.status(400).json({
          success: false,
          message: responseData.message || 'Airtime purchase failed',
          error: responseData.error,
        });
      }
    } else {
      console.log('❌ Proxy: HTTP error:', clubkonnectResponse.status);
      return res.status(400).json({
        success: false,
        message: `Clubkonnect API error: ${clubkonnectResponse.status}`,
        error: `HTTP_${clubkonnectResponse.status}`,
      });
    }
  } catch (error) {
    console.error('❌ Proxy: Exception:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while processing the request',
      error: error.message,
    });
  }
});

// Helper function to extract transaction ID from response
function extractTransactionId(response) {
  const patterns = [
    /transaction[_-]?id[:\s]*([a-zA-Z0-9]+)/i,
    /ref[:\s]*([a-zA-Z0-9]+)/i,
    /id[:\s]*([a-zA-Z0-9]+)/i,
  ];

  for (const pattern of patterns) {
    const match = response.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Proxy server is running' });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Subbig VTU Proxy Server',
    endpoints: {
      'POST /airtime-purchase': 'Purchase airtime via Clubkonnect',
      'GET /health': 'Health check'
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Proxy server running on port ${PORT}`);
  console.log(`📡 Server IP: ${process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost'}`);
});

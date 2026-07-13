/**
 * Appwrite Sync API Service
 * Replaces the mock simulation with real HTTP requests to the Appwrite REST API.
 */

const ENDPOINT = "https://cloud.appwrite.io/v1";
const PROJECT_ID = "69879ae70002444f3f38";
const DATABASE_ID = "6a545eb00016d126bc82";
const COLLECTION_ID = "orders";

async function pushMenuItems(items) {
  // Mocked as success for now since menu collection is not yet configured on Appwrite
  if (items.length > 0) {
    console.log(`[mockApi] (Mock) Pushing ${items.length} menu items to central server...`);
  }
  return { success: true };
}

async function pushOrders(orders) {
  if (orders.length === 0) return { success: true };
  
  console.log(`[mockApi] Pushing ${orders.length} orders to Appwrite...`);
  
  for (const order of orders) {
    const url = `${ENDPOINT}/databases/${DATABASE_ID}/collections/${COLLECTION_ID}/documents`;
    
    // Build payload according to Appwrite Document Create API
    const payload = {
      documentId: order.id,
      data: {
        branch_id: order.branchId || "default",
        total_amount: Number(order.totalAmount) || 0,
        payment_method: order.paymentMethod || "Cash",
        items: JSON.stringify(order.items)
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Appwrite-Project': PROJECT_ID,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[mockApi] Appwrite request failed for order ${order.id} with status ${response.status}:`, errorText);
      // Throw error to trigger retry mechanism in sync engine
      throw new Error(`Appwrite error ${response.status}: ${errorText}`);
    }

    const resData = await response.json();
    console.log(`[mockApi] Successfully synced order ${order.id} to Appwrite. Document ID: ${resData.$id}`);
  }

  return { success: true };
}

async function pushCustomers(customers) {
  // Mocked as success for now since customers collection is not yet configured on Appwrite
  if (customers.length > 0) {
    console.log(`[mockApi] (Mock) Pushing ${customers.length} customers to central server...`);
  }
  return { success: true };
}

async function pullOrders() {
  console.log('[mockApi] Pulling all orders from Appwrite...');
  const url = `${ENDPOINT}/databases/${DATABASE_ID}/collections/${COLLECTION_ID}/documents?limit=1000`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Appwrite-Project': PROJECT_ID
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[mockApi] Appwrite pull failed:', errorText);
    throw new Error(`Appwrite pull error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.documents || [];
}

module.exports = {
  pushMenuItems,
  pushOrders,
  pushCustomers,
  pullOrders
};

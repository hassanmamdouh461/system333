/**
 * Appwrite Sync API Service
 * Replaces the mock simulation with real HTTP requests to the Appwrite REST API.
 */

const ENDPOINT = "https://fra.cloud.appwrite.io/v1";
const PROJECT_ID = "698232950032f12e7895";
const DATABASE_ID = "restaurant_db";
const COLLECTION_ID = "orders";

async function pushMenuItems(items) {
  if (items.length === 0) return { success: true };
  
  console.log(`[mockApi] Pushing ${items.length} menu items to Appwrite...`);
  
  for (const item of items) {
    const url = `${ENDPOINT}/databases/${DATABASE_ID}/collections/menu_items/documents`;
    const docUrl = `${url}/${encodeURIComponent(item.id)}`;
    
    const dataPayload = {
      name: item.name,
      price: Number(item.price),
      category: item.category,
      description: item.description || "",
      image: item.image || "",
      available: Boolean(item.available)
    };

    // Try to update (PATCH) first
    let res = await fetch(docUrl, {
      method: 'PATCH',
      headers: {
        'X-Appwrite-Project': PROJECT_ID,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ data: dataPayload })
    });

    if (res.status === 404) {
      // If 404, create it (POST)
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'X-Appwrite-Project': PROJECT_ID,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          documentId: item.id,
          data: dataPayload,
          permissions: ["read(\"any\")", "write(\"any\")"]
        })
      });
    }

    if (!res.ok) {
      if (res.status === 409) {
        console.warn(`[mockApi] Menu item ${item.id} already exists on Appwrite. Skipping to prevent block.`);
        continue;
      }
      const errorText = await res.text();
      console.error(`[mockApi] Appwrite request failed for menu item ${item.id} with status ${res.status}:`, errorText);
      throw new Error(`Appwrite error ${res.status}: ${errorText}`);
    }

    const resData = await res.json();
    console.log(`[mockApi] Successfully synced menu item ${item.id} to Appwrite.`);
  }

  return { success: true };
}

async function pushOrders(orders) {
  if (orders.length === 0) return { success: true };
  
  console.log(`[mockApi] Pushing ${orders.length} orders to Appwrite...`);
  
  for (const order of orders) {
    const url = `${ENDPOINT}/databases/${DATABASE_ID}/collections/${COLLECTION_ID}/documents`;
    const docUrl = `${url}/${encodeURIComponent(order.id)}`;
    
    const dataPayload = {
      orderNumber: order.orderNumber || "",
      tableId: order.tableId || "",
      status: order.status || "New",
      paymentStatus: order.paymentStatus || "Unpaid",
      totalAmount: Number(order.totalAmount) || 0,
      items: typeof order.items === 'string' ? order.items : JSON.stringify(order.items),
      createdAt: order.createdAt || new Date().toISOString()
    };

    // Try to update (PATCH) first
    let res = await fetch(docUrl, {
      method: 'PATCH',
      headers: {
        'X-Appwrite-Project': PROJECT_ID,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ data: dataPayload })
    });

    if (res.status === 404) {
      // If 404, create it (POST)
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'X-Appwrite-Project': PROJECT_ID,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          documentId: order.id,
          data: dataPayload,
          permissions: ["read(\"any\")", "write(\"any\")"]
        })
      });
    }

    if (!res.ok) {
      if (res.status === 409) {
        console.warn(`[mockApi] Order ${order.id} already exists on Appwrite. Skipping to prevent block.`);
        continue;
      }
      const errorText = await res.text();
      console.error(`[mockApi] Appwrite request failed for order ${order.id} with status ${res.status}:`, errorText);
      throw new Error(`Appwrite error ${res.status}: ${errorText}`);
    }

    const resData = await res.json();
    console.log(`[mockApi] Successfully synced order ${order.id} to Appwrite. Document ID: ${resData.$id}`);
  }

  return { success: true };
}

async function pushCustomers(customers) {
  if (customers.length === 0) return { success: true };
  
  console.log(`[mockApi] Pushing ${customers.length} customers to Appwrite...`);
  
  for (const customer of customers) {
    const url = `${ENDPOINT}/databases/${DATABASE_ID}/collections/customers/documents`;
    const docUrl = `${url}/${encodeURIComponent(customer.id)}`;
    
    const dataPayload = {
      name: customer.name || "Customer",
      phone: customer.phone,
      points: Number(customer.points) || 0,
      createdAt: customer.createdAt || new Date().toISOString(),
      branchId: customer.branchId || "default"
    };

    // Try to update (PATCH) first
    let res = await fetch(docUrl, {
      method: 'PATCH',
      headers: {
        'X-Appwrite-Project': PROJECT_ID,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ data: dataPayload })
    });

    if (res.status === 404) {
      // If 404, create it (POST)
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'X-Appwrite-Project': PROJECT_ID,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          documentId: customer.id,
          data: dataPayload,
          permissions: ["read(\"any\")", "write(\"any\")"]
        })
      });
    }

    if (!res.ok) {
      if (res.status === 409) {
        console.warn(`[mockApi] Customer ${customer.id} already exists on Appwrite. Skipping to prevent block.`);
        continue;
      }
      const errorText = await res.text();
      console.error(`[mockApi] Appwrite request failed for customer ${customer.id} with status ${res.status}:`, errorText);
      throw new Error(`Appwrite error ${res.status}: ${errorText}`);
    }

    console.log(`[mockApi] Successfully synced customer ${customer.id} to Appwrite.`);
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

async function deleteMenuItem(id) {
  const url = `${ENDPOINT}/databases/${DATABASE_ID}/collections/menu_items/documents/${encodeURIComponent(id)}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'X-Appwrite-Project': PROJECT_ID
    }
  });
  if (!response.ok && response.status !== 404) {
    const errorText = await response.text();
    console.error(`[mockApi] Appwrite delete failed for menu item ${id}:`, errorText);
  } else {
    console.log(`[mockApi] Successfully deleted menu item ${id} from Appwrite.`);
  }
}

async function getManagerOrders() {
  console.log('[mockApi] Manager fetching all orders from Appwrite...');
  const url = `${ENDPOINT}/databases/${DATABASE_ID}/collections/orders/documents?limit=1000`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Appwrite-Project': PROJECT_ID
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[mockApi] Appwrite manager orders fetch failed:', errorText);
    throw new Error(`Appwrite error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.documents || [];
}

async function getManagerCustomers() {
  console.log('[mockApi] Manager fetching all customers from Appwrite...');
  const url = `${ENDPOINT}/databases/${DATABASE_ID}/collections/customers/documents?limit=1000`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Appwrite-Project': PROJECT_ID
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[mockApi] Appwrite manager customers fetch failed:', errorText);
    throw new Error(`Appwrite error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.documents || [];
}

module.exports = {
  pushMenuItems,
  pushOrders,
  pushCustomers,
  pullOrders,
  deleteMenuItem,
  getManagerOrders,
  getManagerCustomers
};

/**
 * Created by: Owen Ross <rossow@sheridancollege.ca>
 * Created on: July 25, 2025
 * 
 * Last modified by: Owen Ross <rossow@sheridancollege.ca>
 * Last modified on: August 7, 2025
 * 
 * Purpose:
 * Acts as the controller and middleman:
 *    - Toggles the extension ON/OFF
 *    - Injects scripts and styles into Gmail
 *    - Handles phishing score API communication
 */

// Listening for the user to click the browser extension to turn it on
chrome.action.onClicked.addListener(async (tab) => {
  const url = tab.url || "";
  // Checks if the user is currently on Gmail
  if (!url.startsWith("https://mail.google.com/")) {
    // If the user has the extension on and is not using Gmail, a warning will be issued
    console.warn("Not a Gmail tab. Aborting script injection.");
    return;
  }

  // This will get the current state of the extension badge and change it to ON/OFF depending on its previous state
  const prevState = await chrome.action.getBadgeText({ tabId: tab.id });
  const nextState = prevState === "ON" ? "OFF" : "ON";

  // Set the text for the browser extension badge
  await chrome.action.setBadgeText({ tabId: tab.id, text: nextState });

  if (nextState === "ON") {
    // If the browser extension is on, then insert the css file and execute the JavaScript in the file contentScript.js
    try {
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["style.css"]
      });

      // Execute the code in contentScript.js in the active tab
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["contentScript.js"]
      });
    } catch (e) {
      console.error("Script injection failed:", e);
    }
  }

  // sending a message to the tab, and waiting for the response
  try {
    await chrome.tabs.sendMessage(tab.id, { action: nextState });
  } catch (e) {
    console.warn("Message sending failed:", e);
  }
});

// Listening for a message from the contenScript file, then will make a request to the Flask API
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "FETCH_SCORE") {
      // Getting the authentication token from Google
      chrome.identity.getAuthToken({ interactive: true }, async (token) => {
        // Checking to see if the right token was provided
        console.log("Got token:", token);
        // Checking if there was an error when getting the token
        if (chrome.runtime.lastError || !token) { 
          // Sending the error back to the contentScript, to be logged to the console
          sendResponse({ error: chrome.runtime.lastError?.message || "Token error" });
          return;
        }

        try {
          // making the request to the Flask API
          const response = await fetch("https://phishing-api-proxy-578705582953.us-central1.run.app/predict", {
            // Creating the response to send to the API
            method: "POST",
            headers: {
              "Authorization": `Bearer ${token}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              name: "Developer",
              // The content of the email
              body: message.body
            })
          });

          // Checking the response from the API
          if (!response.ok) {
            // Sending the error back to the contentScript
            sendResponse({ error: `API Error: ${response.statusText}` });
            return;
          }

          // Getting the prediciton from the model, then sending back to contentScript to be displayed
          const data = await response.json();
          const probability = data?.predictions?.[0]?.[0] || 0;
          sendResponse({ probability });
        } catch (err) {
          // Logging an error if the exetension could not get the prediction
          console.error("Fetch error:", err);
          sendResponse({ error: err.message });

        }
      });
      // Keeping the message channel open between contentScript and background
      return true;
    }

});

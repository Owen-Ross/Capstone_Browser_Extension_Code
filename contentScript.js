/**
 * Created by: Owen Ross <rossow@sheridancollege.ca>
 * Created on: July 25, 2025
 * 
 * Last modified by: Owen Ross <rossow@sheridancollege.ca>
 * Last modified on: August 7, 2025
 * 
 * Purpose:
 * Injects script into Gmail tabs when the extension is turned on. It observes the DOM for email content changes, 
 * extracts the email data, displays a UI panel, and fetches phishing prediction scores from a backend NLP model.
 */

// Checking if the script has aready been injected into the current tab
if (window.phishingScriptInjected) {
  console.warn("Phishing script already injected. Skipping...");
} else {
  // Setting the variables that will be used to store information throughout the exetension
  window.phishingScriptInjected = true;
  let enabled = false;
  let observer = null;
  let lastEmailId = "";
  let debounceTimeout = null;

  // Listen for the user to turn the extension on or off
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "ON") {
      enabled = true;
      // Set a delay to wait for Gmail to load
      setTimeout(observeEmailContent, 1000);
    } else {
      // if the extension is turned off, then disconect the observer and close the UI panel
      enabled = false;
      disconnectObserver();
      removeUI();
    }
  });

  // This function will observe the DOM for any changes
  function observeEmailContent() {
    if (observer) return;

    // Creating a new observer object if there is not one already
    observer = new MutationObserver(() => {
      // If a mutation observer has already been created, then don't create a new one
      if (!enabled) return;

      // Checks if there was already a setTimeout object created, if there is, then clear the old one
      if (debounceTimeout) clearTimeout(debounceTimeout);

      debounceTimeout = setTimeout(() => {
        // Getting the email content by using the query functcion
        const subject = document.querySelector("h2.hP")?.innerText;
        const sender = document.querySelector(".gD")?.innerText;
        const senderEmail = document.querySelector(".gD")?.getAttribute("email");
        const dateTime = document.querySelector(".g3")?.getAttribute("title");
        const body = document.querySelector(".a3s")?.innerText;

        // Checking if the current email that is opened is the same as the last email that was opened
        if (subject && body) {
          // Combining the content of the previous email to use as an ID to check if a new email has been opened
          const currentEmailId = subject + senderEmail + dateTime;
          if (currentEmailId === lastEmailId) return;

          // If the content of the email is different than the previous email, then update the UI with the new email content
          lastEmailId = currentEmailId;
          updateUI({ subject, sender, senderEmail, dateTime, body });
        }
      }, 500);
    });

    // Telling the MutationObserver object what to observe
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Disconnecting the MutationObserver when the extension is turned off
  function disconnectObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  // This function will remove the UI panel from the web page
  function removeUI() {
    const existing = document.getElementById("phishing-ui");
    if (existing) existing.remove();
  }

  // This function will update the UI once a new email has been opened
  function updateUI({ subject, sender, senderEmail, dateTime, body }) {
    removeUI();

    // Adding the UI panel to the current emsil
    const container = document.createElement("div");
    container.id = "phishing-ui";

    // Creating the HTML that will be used to display the email content and phishing probability
    container.innerHTML = container.innerHTML = `
        <div class="phishing-popup" id="phishing-ui">
          <div class="phishing-header">Email Analysis</div>

          <div class="phishing-score-container">

              <svg viewBox="0 0 100 50" class="progress-ring">
                <path class="bg" d="M 5 50 A 45 45 0 0 1 95 50" />
                <path class="progress" d="M 5 50 A 45 45 0 0 1 95 50" />
              </svg>

            </svg>
            <div class="score-text">--%</div>
          </div>

          <details>
            <summary><strong>Subject</strong></summary>
            <div>${sanitize(subject)}</div>
          </details>

          <details>
            <summary><strong>From</strong></summary>
            <div>${sanitize(sender)} &lt;${sanitize(senderEmail)}&gt;</div>
          </details>

          <details>
            <summary><strong>Date</strong></summary>
            <div>${sanitize(dateTime)}</div>
          </details>

          <details>
            <summary><strong>Body Preview</strong></summary>
            <div class="body-scroll">
              <div id="body-preview"></div>
              <button class="show-full-body">Show Full Email</button>
              <div id="full-body" style="display:none;"></div>
            </div>
          </details>

          <button class="phishing-close">Close</button>
        </div>
      `;

    // Adding the styling class "phishing-popup" to the UI panel
    container.classList.add("phishing-popup");

    // Adding the UI panel to the webpage
    document.body.appendChild(container);

    // Adding the body preview to the UI dropdown
    const bodyPreviewDiv = container.querySelector("#body-preview");
    if (bodyPreviewDiv) {
      const snippet = body.length > 200 ? body.slice(0, 200) + "..." : body;
      bodyPreviewDiv.innerHTML = sanitize(snippet);
    }

    // Adding the full email body text to the UI dropdown
    const fullBodyDiv = container.querySelector("#full-body");
    if (fullBodyDiv) {
      fullBodyDiv.innerHTML = sanitize(body);
    }

    // Adding the show full body button to the email body dropdown 
    const showFullBtn = container.querySelector(".show-full-body");
    showFullBtn.addEventListener("click", () => {
      fullBodyDiv.style.display = "block";
      showFullBtn.style.display = "none";
    });

    // Closing the UI panel when the user clicks the close button
    container.querySelector(".phishing-close").onclick = () => container.remove();

    // Getting the phishing prediction from the NLP model
    fetchPhishingScore(body);
  }

  // This function will make a request passing the email content to the 
  async function fetchPhishingScore(text) {
    const scoreElement = document.querySelector(".score-text");
    // Displaying a loading spinner, while waiting for the model to return the prediciton score
    if (scoreElement) {
      scoreElement.innerHTML = `<span class="loading-spinner"></span> Loading...`;
    }

    try {
      // Send a message to background and wait for the response to 
      const response = await new Promise((resolve, reject) => {
        // Sending a message to background, that will get the prediciton probability from the NLP model
        chrome.runtime.sendMessage(
          { action: "FETCH_SCORE", body: text },
          // Checks if background responded with an error or success message
          (response) => {
            if (chrome.runtime.lastError || response?.error) {
              reject(response?.error || chrome.runtime.lastError);
            } else {
              resolve(response);
            }
          }
        );
      });

      // Getting the probability value from the model, and displaying it to the user
      const probability = response.probability || 0;
      if (scoreElement) {
        // Getting the progress bar and prediction text to update them
        const progressPath = document.querySelector("path.progress");
        const scoreText = document.querySelector(".score-text");

        // Get the percentage value and times it by 100 to display to the user
        const percent = (probability * 100).toFixed(2);
        // uUsing the percentage to get the new position on the progress bar
        const offset = 126 - (126 * percent) / 100;

        // Setting the progress bar to the new prediciton value
        progressPath.style.strokeDashoffset = offset;
        // Displaying the new predition to the user
        scoreText.innerText = `${percent}%`;

        // Setting what colours the progress bar can change to depending on the probability
        let color = "#4caf50"; // Green
        if (probability > 0.85) {
          color = "#f44336"; // Red
        } else if (probability > 0.5) {
          color = "#ff9800"; // Orange
        }

        // Setting the colour of the progress bar and prediction score
        progressPath.style.stroke = color;
        scoreText.style.color = color;
      }
      // Checking if there was an error in getting the phishing probability
    } catch (err) {
      // Diplaying the error in the console and in the UI
      console.error("Phishing API error:", err);
      if (scoreElement) {
        scoreElement.innerText = "Error";
      }
    }
  }
}

// This function will sanitize the text and remove all of the HTML tags from the content
function sanitize(str) {
  const div = document.createElement("div");
  div.innerText = str || "";
  return div.innerHTML;
}
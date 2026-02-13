const fs = require('fs');
const path = require('path');

// Test the Schedule C PDF export API
async function testScheduleCPDF() {
  console.log('🧪 Testing Schedule C PDF Export API...');
  
  try {
    // Test the API endpoint
    const response = await fetch('http://localhost:3000/api/tax/schedule-c/export', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        year: '2024'
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ API request failed:', response.status, errorText);
      return;
    }

    // Check if we got a PDF response
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/pdf')) {
      console.log('✅ PDF generated successfully!');
      
      // Save the PDF to a file for inspection
      const pdfBuffer = await response.arrayBuffer();
      const outputPath = path.join(__dirname, 'test-schedule-c-export.pdf');
      fs.writeFileSync(outputPath, Buffer.from(pdfBuffer));
      console.log(`📄 PDF saved to: ${outputPath}`);
      
      // Check file size
      const stats = fs.statSync(outputPath);
      console.log(`📊 PDF file size: ${(stats.size / 1024).toFixed(2)} KB`);
      
      if (stats.size > 1000) {
        console.log('✅ PDF has content (not empty)');
      } else {
        console.log('⚠️ PDF file is very small, might be empty');
      }
    } else {
      console.log('❌ Response is not a PDF:', contentType);
      const text = await response.text();
      console.log('Response content:', text.substring(0, 200));
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testScheduleCPDF();

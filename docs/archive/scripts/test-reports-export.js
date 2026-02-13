const fs = require('fs');
const path = require('path');

// Test the new reports export API
async function testReportsExport() {
  console.log('🧪 Testing Reports Export API...');
  
  const formTypes = ['form8829', 'form4562', 'scheduleSE'];
  
  for (const formType of formTypes) {
    console.log(`\n📋 Testing ${formType}...`);
    
    try {
      const response = await fetch('http://localhost:3000/api/reports/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: formType }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ ${formType} API request failed:`, response.status, errorText);
        continue;
      }

      // Check if we got a PDF response
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/pdf')) {
        console.log(`✅ ${formType} PDF generated successfully!`);
        
        // Save the PDF to a file for inspection
        const pdfBuffer = await response.arrayBuffer();
        const outputPath = path.join(__dirname, `test-${formType}-export.pdf`);
        fs.writeFileSync(outputPath, Buffer.from(pdfBuffer));
        console.log(`📄 PDF saved to: ${outputPath}`);
        
        // Check file size
        const stats = fs.statSync(outputPath);
        console.log(`📊 PDF file size: ${(stats.size / 1024).toFixed(2)} KB`);
        
        if (stats.size > 1000) {
          console.log(`✅ ${formType} PDF has content (not empty)`);
        } else {
          console.log(`⚠️ ${formType} PDF file is very small, might be empty`);
        }
      } else {
        console.log(`❌ ${formType} Response is not a PDF:`, contentType);
        const text = await response.text();
        console.log('Response content:', text.substring(0, 200));
      }
      
    } catch (error) {
      console.error(`❌ ${formType} Test failed:`, error.message);
    }
  }
}

// Test with sample data setup
async function testWithSampleData() {
  console.log('\n🔧 Setting up sample data...');
  
  // This would typically involve setting up test data in Firestore
  // For now, we'll just test the API endpoints
  console.log('Note: This test requires the app to be running with sample data');
  console.log('Make sure you have:');
  console.log('1. Home office settings configured');
  console.log('2. Business assets added');
  console.log('3. Schedule C data available');
  
  await testReportsExport();
}

// Run the test
if (require.main === module) {
  testWithSampleData().catch(console.error);
}

module.exports = { testReportsExport, testWithSampleData };

# VoIPmonitor MCP Server

A Model Context Protocol (MCP) server that provides AI assistants with the ability to search and analyze VoIP call records from VoIPmonitor. Perfect for support teams who need to quickly investigate call quality issues, disconnections, and troubleshoot VoIP problems.

## Features

This MCP server provides four main tools for support agents:

### 🔍 `search_calls`
Search for calls by various criteria:
- Time ranges (date/time)
- Caller/called phone numbers  
- SIP Call-ID
- Connected vs all calls
- Configurable result limits

### 📋 `get_call_details`
Get comprehensive information about a specific call:
- Basic call information (duration, parties, timestamps)
- Call quality metrics (MOS, packet loss, jitter)
- SIP message history and call flow
- Response codes and status

### 📦 `get_pcap_info`
Get packet capture information for network analysis:
- Direct PCAP download links
- Option to include/exclude RTP data
- Ready for Wireshark analysis

### 🚨 `search_problem_calls`
Pre-built searches for common support scenarios:
- **Disconnections**: Calls that ended unexpectedly
- **Quality Issues**: Poor MOS scores, high packet loss
- **Failed Calls**: SIP 4xx/5xx error responses

## Quick Setup

### 1. Configure VoIPmonitor Credentials

Create a service account in VoIPmonitor with read-only access to CDR data, then set these environment variables:

For local development, copy `.env.example` to `.env`:
```bash
VOIPMONITOR_URL=https://your-voipmonitor-server.com
VOIPMONITOR_USER=api-service  
VOIPMONITOR_PASSWORD=your-password
```

For production, set as Cloudflare Worker secrets:
```bash
npx wrangler secret put VOIPMONITOR_URL
npx wrangler secret put VOIPMONITOR_USER
npx wrangler secret put VOIPMONITOR_PASSWORD
```

### 2. Deploy to Cloudflare

```bash
# Install dependencies
npm install

# Deploy to Cloudflare Workers
npm run deploy
```

### 3. Connect to Claude Desktop

Add to your Claude Desktop configuration file:

```json
{
  "mcpServers": {
    "voipmonitor": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://your-worker.your-subdomain.workers.dev/sse"
      ]
    }
  }
}
```

## Usage Examples

Once connected, you can ask Claude natural language questions like:

### Call Investigation
- *"Find all calls from 555-1234 yesterday"*
- *"Show me calls that lasted more than 10 minutes today"*
- *"Get details for call ID abc-123-def"*

### Quality Troubleshooting  
- *"Find calls with poor quality in the last 2 hours"*
- *"Show me all disconnected calls today"*
- *"Search for failed calls this morning"*

### Network Analysis
- *"Get the PCAP file for call 12345 for network analysis"*
- *"I need the packet capture for troubleshooting this call quality issue"*

## Development

### Local Development
```bash
# Start local development server
npm run dev

# Test with MCP Inspector
npx @modelcontextprotocol/inspector
# Connect to: http://localhost:8787/sse
```

### Authentication Flow
The MCP server automatically handles VoIPmonitor authentication:
1. Uses username/password to get session token
2. Maintains session for subsequent API calls  
3. Re-authenticates if session expires

### Error Handling
- Clear error messages for missing credentials
- Graceful handling of VoIPmonitor API errors
- Fallback behavior when optional data (like SIP history) isn't available

## API Tools Reference

### search_calls
**Parameters:**
- `startTime` (required): Start time in YYYY-MM-DD or YYYY-MM-DD HH:MM:SS format
- `endTime` (optional): End time in same format
- `caller` (optional): Caller phone number
- `called` (optional): Called phone number  
- `callId` (optional): SIP Call-ID header value
- `onlyConnected` (optional): Return only connected calls (default: false)
- `limit` (optional): Maximum results (default: 50)

### get_call_details
**Parameters:**
- `cdrId` (required): CDR ID of the call

### get_pcap_info  
**Parameters:**
- `cdrId` (required): CDR ID of the call
- `includeRtp` (optional): Include RTP data (default: true)

### search_problem_calls
**Parameters:**
- `issueType` (required): "disconnections", "quality", or "failed_calls"
- `timeRange` (required): "1h", "2h", "today", or specific date
- `limit` (optional): Maximum results (default: 20)

## Security Notes

- Uses read-only service account for VoIPmonitor access
- All credentials stored as encrypted Cloudflare Worker secrets
- Session tokens are temporary and automatically renewed
- No sensitive call data is cached or logged

## Troubleshooting

### Connection Issues
1. Verify VoIPmonitor URL is accessible from Cloudflare Workers
2. Check service account credentials are correct
3. Ensure VoIPmonitor API is enabled and accessible

### Authentication Errors
1. Verify service account has CDR read permissions
2. Check username/password are correctly set as secrets
3. Test credentials manually with VoIPmonitor API

### No Results Found
1. Check date/time formats are correct
2. Verify time ranges contain actual call data
3. Ensure search criteria match existing calls

## Support

For issues with:
- **MCP Server**: Check Cloudflare Worker logs via `wrangler tail`
- **VoIPmonitor Integration**: Verify API access and credentials
- **Claude Connection**: Restart Claude Desktop and check configuration

## License

This project is licensed under the Apache 2.0 License.
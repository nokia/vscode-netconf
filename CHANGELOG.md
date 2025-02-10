# NETCONF CLIENT for Visual Studio Code

## Change Log

Notable changes to the "vscode-netconf" extension are documented in this file.

### [1.1.0]
* Client capabilities are now configurable in the `netconf.serverList`.
  By default, `vscode-netconf` is sending the `base:1.0` and `base:1.1`
  capabilities to the server. By making the capabilities configurable,
  the desired framing mechanism can be enforced. In addition, it is
  possible to enable device-level feature like private candidates in
  Nokia SR OS.
* The execution time for RPCs is now captured and shown to the user.
  This is to get some initial idea on performance for a given
  `edit-config` or `commit` RPC. It is targeted for integrators
  to optimize the communication to the server and to implement
  response time-outs.

  The execution time is only shown to RPCs that return a simple
  `</ok>` as part of the confirmation dialogue. It's not available
  for RPCs that return detailed responses like `<get>`, `<get-config`.
  For those cases, it is shown in the console-log only.

### [1.2.0]
* Improved logging using a dedicated vsCode OUTPUT channel called `netconf`.
* Support for vsCode REMOTE SSH in case you don't have direct connectivity
  to your network devices. Use `Remote SSH` to connect to your SSH jumphost,
  and install this NETCONF extension using vsCode on the remote host.
  When using containerized environments most propably the host running
  containerlab is your SSH target.

### [1.2.1]
* Improved error-handling for Ciena supporting XML tags to fix:
  https://github.com/nokia/vscode-netconf/issues/2

### [2.0.0]
* New user-interface: NETCONF view (check activity bar/side bar)
  Note: Old UI is not longer available
* Allow multiple concurrent connections to multiple servers
  Note: Dedicated OUTPUT channels are used per server
* Adhoc NETCONF connections from containerlab extension
* Ask user for password, if authentication has failed

### [2.1.0]
* Use hostname for containerlab (instead of IP)
* Names for output channels (logging) using id (instead of hostname/IP)
* Provide password for new connections
* Taxonomy consistency: managed devices
* Connections are displayed with session-id
* Option to clone managed device entries
* Various error-handling improvements
* Update entries w/ cross-navigation to settings json

### [2.1.1]
* UTF-8 support w/ chunked framing
* Support for ssh-transport logging
* Send custom <rpc> works again from `editor/title/run`
* Corresponding output channel opens automatically when selecting a connection (spotlight)

### [2.1.2]
* Improved logic to trigger custom <rpc> from open XML document
  Note: using activeTabGroup/activeTab (if scheme is XML)

---

**Copyright (c) 2025 NOKIA**
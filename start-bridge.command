#!/bin/bash
# Double-clickable launcher for the Enter Key Clicker bridge helper.
# Add this file to System Settings -> Login Items to auto-start on login.
cd "$(dirname "$0")"
echo "Starting the Enter Key Clicker bridge helper..."
python3 bridge.py

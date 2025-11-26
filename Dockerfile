# Use official piston engine
FROM ghcr.io/engineer-man/piston:latest

# Create folder for installed language packages
RUN mkdir -p /piston/packages

# Install GCC (C, C++)
RUN cd /piston/packages && \
    wget https://github.com/engineer-man/piston/releases/download/pkgs/gcc-10.2.0.tar.gz && \
    tar -xf gcc-10.2.0.tar.gz && \
    rm gcc-10.2.0.tar.gz

# Install Python 3.10
RUN cd /piston/packages && \
    wget https://github.com/engineer-man/piston/releases/download/pkgs/python-3.10.0.tar.gz && \
    tar -xf python-3.10.0.tar.gz && \
    rm python-3.10.0.tar.gz

# Install Node.js (JavaScript)
RUN cd /piston/packages && \
    wget https://github.com/engineer-man/piston/releases/download/pkgs/node-18.15.0.tar.gz && \
    tar -xf node-18.15.0.tar.gz && \
    rm node-18.15.0.tar.gz

# Install Java
RUN cd /piston/packages && \
    wget https://github.com/engineer-man/piston/releases/download/pkgs/java-15.0.2.tar.gz && \
    tar -xf java-15.0.2.tar.gz && \
    rm java-15.0.2.tar.gz

# Expose API port (Piston runs on 2000 by default)
EXPOSE 2000

# Start piston API
CMD [ "piston-api" ]